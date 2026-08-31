import { ConflictException, Injectable, Logger } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { QueryFailedError, Repository } from "typeorm";
import { createHash } from "node:crypto";

import { SocialIdentity, type SocialAuthProvider, User } from "../../entities";
import { UsersService } from "../users/users.service";

const PG_UNIQUE_VIOLATION = "23505";
function isUniqueViolation(err: unknown): boolean {
  return (
    err instanceof QueryFailedError &&
    (err as QueryFailedError & { code?: string }).code === PG_UNIQUE_VIOLATION
  );
}

/** Apple hides real emails behind this domain when the user opts out of sharing. */
export function isApplePrivateRelay(email: string): boolean {
  return email.trim().toLowerCase().endsWith("@privaterelay.appleid.com");
}

export interface ResolveIdentityInput {
  provider: SocialAuthProvider;
  subject: string;
  email?: string | null;
  fullName?: string | null;
  picture?: string | null;
  /**
   * Whether the PROVIDER asserts this email is verified (Google/Apple
   * `email_verified`). Required — alongside a verified local account — before an
   * unknown provider subject may auto-link to a pre-existing local account.
   * Defaults to false (treated as unverified) when the caller cannot prove it.
   */
  emailVerified?: boolean;
}

/** Public-safe view of a linked social identity (no subject, no tokens). */
export interface SocialConnection {
  provider: SocialAuthProvider;
  email: string | null;
  isPrivateRelay: boolean;
  connectedAt: string;
  lastAuthenticatedAt: string | null;
}

/**
 * Resolves and links social-provider identities to Repitair users.
 *
 * Identity is keyed on the provider's stable subject `(provider, providerSubject)`,
 * never on email. This prevents Apple private-relay logins from spawning a new
 * account on every sign-in and lets one user own email/password + Google + Apple.
 *
 * Resolution policy (deliberately conservative — no silent cross-account merges):
 *   1. Known subject                       → the already-linked user.
 *   2. Unknown subject, real (non-relay)
 *      email matches an existing user AND
 *      both provider + local email verified → link to that user.
 *   3. Unknown subject, email matches an
 *      UNVERIFIED local account            → create a separate account (synthetic
 *                                            email); never link (pre-hijack guard).
 *   4. Otherwise                           → create a new user, keyed by subject.
 */
@Injectable()
export class SocialIdentityService {
  private readonly logger = new Logger(SocialIdentityService.name);

  constructor(
    @InjectRepository(SocialIdentity)
    private readonly identities: Repository<SocialIdentity>,
    private readonly usersService: UsersService,
  ) {}

  async resolveUser(input: ResolveIdentityInput): Promise<User> {
    const email = input.email?.trim().toLowerCase() || null;
    const isRelay = email ? isApplePrivateRelay(email) : false;

    // 1. Known provider subject → its linked user.
    const existing = await this.identities.findOne({
      where: { provider: input.provider, providerSubject: input.subject },
    });
    if (existing) {
      const user = await this.usersService.findById(existing.userId);
      if (user) {
        existing.lastAuthenticatedAt = new Date();
        if (email) existing.providerEmail = email;
        existing.providerEmailIsPrivateRelay = isRelay;
        await this.identities.save(existing);
        await this.usersService.setAvatarIfMissing(user.id, input.picture ?? null);
        return user;
      }
      // Orphaned identity (user removed) — drop it and fall through.
      await this.identities.delete({ id: existing.id });
    }

    // 2. Unknown subject. Auto-linking to a pre-existing local account is only
    //    safe when ALL hold: a real (non-relay) email, the PROVIDER asserts the
    //    email is verified, AND the local account's own email is verified.
    //    Linking to an unverified local account is the account pre-hijacking
    //    vector: an attacker pre-registers the victim's email (never verifying
    //    it), then inherits the account the moment the victim signs in socially.
    //    We refuse that merge and instead key a *separate* social account off a
    //    synthetic email — the pre-existing account is never linked or exposed.
    let user: User | null = null;
    if (email && !isRelay) {
      const localMatch = await this.usersService.findByEmail(email);
      if (localMatch) {
        const safeToLink =
          input.emailVerified === true && localMatch.emailVerified === true;
        if (safeToLink) {
          user = localMatch;
          await this.usersService.setAvatarIfMissing(
            user.id,
            input.picture ?? null,
          );
        } else {
          // Conflict with an untrusted local account — keep them separate.
          user = await this.createIsolatedSocialUser({
            subject: input.subject,
            fullName: input.fullName?.trim() || this.deriveName(email),
            email: this.syntheticEmail(input.provider, input.subject),
            avatarUrl: input.picture ?? undefined,
            signupSource: input.provider,
          });
        }
      }
    }

    if (!user) {
      // 3. No linkable local account (or relay / no email): create a new user.
      //    Use the real email only when it is a non-relay address with no
      //    pre-existing owner; otherwise a stable synthetic address.
      user = await this.createIsolatedSocialUser({
        subject: input.subject,
        fullName: input.fullName?.trim() || this.deriveName(email),
        email:
          email && !isRelay
            ? email
            : this.syntheticEmail(input.provider, input.subject),
        avatarUrl: input.picture ?? undefined,
        signupSource: input.provider,
      });
    }

    return this.persistLinkResolvingConflicts(user, input, email, isRelay);
  }

  /**
   * Attach a provider identity to an already-authenticated user (the
   * "Connect account" flow). Rejects if the identity already belongs elsewhere.
   */
  async linkToUser(userId: string, input: ResolveIdentityInput): Promise<void> {
    const email = input.email?.trim().toLowerCase() || null;
    const isRelay = email ? isApplePrivateRelay(email) : false;

    const existing = await this.identities.findOne({
      where: { provider: input.provider, providerSubject: input.subject },
    });
    if (existing) {
      if (existing.userId !== userId) {
        throw new ConflictException(
          `This ${input.provider} account is already linked to a different Repitair account.`,
        );
      }
      existing.lastAuthenticatedAt = new Date();
      if (email) existing.providerEmail = email;
      existing.providerEmailIsPrivateRelay = isRelay;
      await this.identities.save(existing);
      return;
    }
    try {
      await this.identities.save(
        this.identities.create({
          userId,
          provider: input.provider,
          providerSubject: input.subject,
          providerEmail: email,
          providerEmailIsPrivateRelay: isRelay,
          lastAuthenticatedAt: new Date(),
        }),
      );
    } catch (err) {
      if (isUniqueViolation(err)) {
        // A concurrent request linked this subject first. Never assume success:
        // load the winning row and confirm it belongs to THIS user. If it went
        // to someone else, surface the conflict rather than swallowing it.
        const winner = await this.identities.findOne({
          where: { provider: input.provider, providerSubject: input.subject },
        });
        if (winner && winner.userId !== userId) {
          throw new ConflictException(
            `This ${input.provider} account is already linked to a different Repitair account.`,
          );
        }
        return;
      }
      throw err;
    }
  }

  /** The social providers linked to a user (for the profile DTO). */
  async getLinkedProviders(userId: string): Promise<SocialAuthProvider[]> {
    const rows = await this.identities.find({ where: { userId } });
    return [...new Set(rows.map((r) => r.provider))];
  }

  /**
   * Detailed connection info for the Connected Accounts screen — one entry per
   * linked provider (deduplicated), newest link first. Exposes only the
   * provider email, private-relay flag, and timestamps; never the subject.
   */
  async getConnections(userId: string): Promise<SocialConnection[]> {
    const rows = await this.identities.find({
      where: { userId },
      order: { createdAt: "DESC" },
    });
    const seen = new Set<SocialAuthProvider>();
    const connections: SocialConnection[] = [];
    for (const row of rows) {
      if (seen.has(row.provider)) continue;
      seen.add(row.provider);
      connections.push({
        provider: row.provider,
        email: row.providerEmail ?? null,
        isPrivateRelay: row.providerEmailIsPrivateRelay,
        connectedAt: row.createdAt.toISOString(),
        lastAuthenticatedAt: row.lastAuthenticatedAt
          ? row.lastAuthenticatedAt.toISOString()
          : null,
      });
    }
    return connections;
  }

  /**
   * Remove every identity row for `(user, provider)` — the "Disconnect" action.
   * Returns the number of rows deleted so the caller can distinguish a real
   * unlink from a no-op. The last-remaining-method guard lives in AuthService,
   * which knows about the password method too.
   */
  async unlink(userId: string, provider: SocialAuthProvider): Promise<number> {
    const result = await this.identities.delete({ userId, provider });
    return result.affected ?? 0;
  }

  /**
   * Persist a new identity for a freshly-resolved user and return the user that
   * actually owns the `(provider, subject)` after any concurrent race. The
   * unique index on `(provider, providerSubject)` is the serialization point: if
   * a parallel request inserted the same subject first, we reload the WINNING row
   * and return its user instead of blindly reporting our candidate as success.
   */
  private async persistLinkResolvingConflicts(
    user: User,
    input: ResolveIdentityInput,
    email: string | null,
    isRelay: boolean,
  ): Promise<User> {
    try {
      await this.identities.save(
        this.identities.create({
          userId: user.id,
          provider: input.provider,
          providerSubject: input.subject,
          providerEmail: email,
          providerEmailIsPrivateRelay: isRelay,
          lastAuthenticatedAt: new Date(),
        }),
      );
      return user;
    } catch (err) {
      if (isUniqueViolation(err)) {
        this.logger.warn(
          `provider=${input.provider} link race resolved (subject already linked)`,
        );
        const winner = await this.identities.findOne({
          where: { provider: input.provider, providerSubject: input.subject },
        });
        if (winner) {
          const winningUser = await this.usersService.findById(winner.userId);
          if (winningUser) return winningUser;
        }
      }
      throw err;
    }
  }

  private deriveName(email: string | null): string {
    if (!email) return "Repitair User";
    const base = email.split("@")[0]?.trim();
    if (!base) return "Repitair User";
    const words = base
      .split(/[._-]+/)
      .filter(Boolean)
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1));
    return words.length ? words.join(" ") : "Repitair User";
  }

  /**
   * Create a social user without ever adopting the owner of a colliding real
   * email. If that address is claimed after our lookup, retry with the reserved
   * provider-subject address. A collision on the reserved address is safe to
   * reuse only when it is already a social-only account for the same provider.
   */
  private async createIsolatedSocialUser(data: {
    subject: string;
    fullName: string;
    email: string;
    avatarUrl?: string;
    signupSource: SocialAuthProvider;
  }): Promise<User> {
    const { subject, ...userData } = data;
    const synthetic = this.syntheticEmail(data.signupSource, subject);

    try {
      return await this.usersService.createSocialUser(userData);
    } catch (error) {
      if (!(error instanceof ConflictException)) throw error;
    }

    // A real email was claimed after the preceding lookup. Never adopt its
    // owner; isolate this identity behind its provider-subject address.
    if (userData.email !== synthetic) {
      try {
        return await this.usersService.createSocialUser({
          ...userData,
          email: synthetic,
        });
      } catch (error) {
        if (!(error instanceof ConflictException)) throw error;
      }
    }

    // Concurrent requests for the same provider subject may both reach the
    // synthetic insert. Reuse only an account that is provably the matching
    // social-only account; a password account can never claim this namespace.
    const existing = await this.usersService.findByEmail(synthetic);
    if (
      existing &&
      existing.signupSource === data.signupSource &&
      existing.hasUsablePassword === false
    ) {
      return existing;
    }
    throw new ConflictException("Could not safely create the social account");
  }

  /** Stable placeholder email when a provider genuinely supplies none. */
  private syntheticEmail(provider: SocialAuthProvider, subject: string): string {
    const digest = createHash("sha256")
      .update(`${provider}:${subject}`)
      .digest("hex")
      .slice(0, 40);
    return `${provider}_${digest}@social.repitair.invalid`;
  }
}
