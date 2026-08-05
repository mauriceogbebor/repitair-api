import { ConflictException, Injectable, Logger } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { QueryFailedError, Repository } from "typeorm";

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
 *      email matches an existing user      → link to that user.
 *   3. Otherwise                           → create a new user, keyed by subject.
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

    // 2. Unknown subject. Only link to an existing account when the provider
    //    email is a real (non-relay) address matching an existing user. Never
    //    link or merge on a private-relay email.
    let user: User | null = null;
    if (email && !isRelay) {
      user = await this.usersService.findByEmail(email);
    }

    if (user) {
      await this.usersService.setAvatarIfMissing(user.id, input.picture ?? null);
    } else {
      // 3. Create a new user keyed by this subject.
      user = await this.usersService.createSocialUser({
        fullName: input.fullName?.trim() || this.deriveName(email),
        email: email ?? this.syntheticEmail(input.provider, input.subject),
        avatarUrl: input.picture ?? undefined,
        signupSource: input.provider,
      });
    }

    await this.persistLink(user.id, input, email, isRelay);
    return user;
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
    await this.persistLink(userId, input, email, isRelay);
  }

  /** The social providers linked to a user (for the profile DTO). */
  async getLinkedProviders(userId: string): Promise<SocialAuthProvider[]> {
    const rows = await this.identities.find({ where: { userId } });
    return [...new Set(rows.map((r) => r.provider))];
  }

  private async persistLink(
    userId: string,
    input: ResolveIdentityInput,
    email: string | null,
    isRelay: boolean,
  ): Promise<void> {
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
        // A concurrent request linked the same subject first — safe to ignore.
        this.logger.warn(
          `provider=${input.provider} link race resolved (subject already linked)`,
        );
        return;
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

  /** Stable placeholder email when a provider genuinely supplies none. */
  private syntheticEmail(provider: SocialAuthProvider, subject: string): string {
    const safe = subject.replace(/[^a-zA-Z0-9]/g, "").slice(0, 40) || "user";
    return `${provider}_${safe}@users.repitair.com`;
  }
}
