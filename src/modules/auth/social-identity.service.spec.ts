import { ConflictException } from "@nestjs/common";
import { SocialIdentityService, isApplePrivateRelay } from "./social-identity.service";

describe("SocialIdentityService", () => {
  let repo: {
    findOne: jest.Mock;
    save: jest.Mock;
    create: jest.Mock;
    delete: jest.Mock;
    find: jest.Mock;
  };
  let users: {
    findById: jest.Mock;
    findByEmail: jest.Mock;
    createSocialUser: jest.Mock;
    setAvatarIfMissing: jest.Mock;
  };
  let service: SocialIdentityService;

  const linkedUser = { id: "user-1", email: "real@example.com", emailVerified: true };
  const createdUser = { id: "user-new", email: "created@example.com" };

  beforeEach(() => {
    repo = {
      findOne: jest.fn(),
      save: jest.fn(async (x: unknown) => x),
      create: jest.fn((x: unknown) => x),
      delete: jest.fn(),
      find: jest.fn(),
    };
    users = {
      findById: jest.fn(),
      findByEmail: jest.fn(),
      createSocialUser: jest.fn().mockResolvedValue(createdUser),
      setAvatarIfMissing: jest.fn(),
    };
    service = new SocialIdentityService(repo as never, users as never);
  });

  it("detects Apple private relay addresses", () => {
    expect(isApplePrivateRelay("mc5ph9zs44@privaterelay.appleid.com")).toBe(true);
    expect(isApplePrivateRelay("me@gmail.com")).toBe(false);
  });

  it("returns the SAME user for a known provider subject (no duplicate on repeat login)", async () => {
    repo.findOne.mockResolvedValue({ id: "idn-1", userId: "user-1" });
    users.findById.mockResolvedValue(linkedUser);

    const result = await service.resolveUser({
      provider: "apple",
      subject: "apple-sub-42",
      email: "mc5ph9zs44@privaterelay.appleid.com",
    });

    expect(result).toBe(linkedUser);
    expect(users.createSocialUser).not.toHaveBeenCalled();
    expect(repo.save).toHaveBeenCalled(); // updates lastAuthenticatedAt
  });

  it("creates a dedicated account for an unknown Apple relay subject — never merges on relay email", async () => {
    repo.findOne.mockResolvedValue(null);

    const result = await service.resolveUser({
      provider: "apple",
      subject: "apple-sub-new",
      email: "mc5ph9zs44@privaterelay.appleid.com",
    });

    // Must NOT try to match an existing account by a private-relay email.
    expect(users.findByEmail).not.toHaveBeenCalled();
    expect(users.createSocialUser).toHaveBeenCalled();
    expect(result).toBe(createdUser);
    expect(repo.save).toHaveBeenCalled(); // persists the identity link
  });

  it("links an unknown subject to an existing user only when BOTH provider and local email are verified", async () => {
    repo.findOne.mockResolvedValue(null);
    users.findByEmail.mockResolvedValue(linkedUser); // emailVerified: true

    const result = await service.resolveUser({
      provider: "google",
      subject: "google-sub-7",
      email: "real@example.com",
      emailVerified: true, // provider asserts verified
      picture: "https://pic",
    });

    expect(users.findByEmail).toHaveBeenCalledWith("real@example.com");
    expect(users.createSocialUser).not.toHaveBeenCalled();
    expect(users.setAvatarIfMissing).toHaveBeenCalledWith("user-1", "https://pic");
    expect(result).toBe(linkedUser);
  });

  it("PRE-HIJACK GUARD: never links to an UNVERIFIED local account, even on a matching verified provider email", async () => {
    // Attacker pre-registered the victim's email as an unverified password account.
    repo.findOne.mockResolvedValue(null);
    users.findByEmail.mockResolvedValue({
      id: "attacker-1",
      email: "victim@example.com",
      emailVerified: false,
    });

    const result = await service.resolveUser({
      provider: "google",
      subject: "google-victim-sub",
      email: "victim@example.com",
      emailVerified: true, // Google says the address is verified…
    });

    // …but the local account is unverified, so we MUST NOT hand the victim's
    // social login to the attacker's account. A separate account is created.
    expect(users.createSocialUser).toHaveBeenCalled();
    const createArg = users.createSocialUser.mock.calls[0][0];
    expect(createArg.email).not.toBe("victim@example.com"); // synthetic, not the real email
    expect(result).toBe(createdUser);
    expect(result).not.toEqual(expect.objectContaining({ id: "attacker-1" }));
  });

  it("does not link when the PROVIDER email is unverified, even if the local account is verified", async () => {
    repo.findOne.mockResolvedValue(null);
    users.findByEmail.mockResolvedValue(linkedUser); // local emailVerified: true

    const result = await service.resolveUser({
      provider: "google",
      subject: "google-sub-unverified-provider",
      email: "real@example.com",
      emailVerified: false, // provider did NOT assert verification
    });

    expect(users.createSocialUser).toHaveBeenCalled();
    expect(result).toBe(createdUser);
  });

  it("creates a new user when an unknown subject has no matching account", async () => {
    repo.findOne.mockResolvedValue(null);
    users.findByEmail.mockResolvedValue(null);

    const result = await service.resolveUser({
      provider: "google",
      subject: "google-sub-9",
      email: "brandnew@example.com",
    });

    expect(users.createSocialUser).toHaveBeenCalled();
    expect(result).toBe(createdUser);
  });

  it("CONCURRENCY: resolveUser loses the insert race and returns the WINNING row's user (no false success)", async () => {
    const pgUnique = Object.assign(new (require("typeorm").QueryFailedError)("q", [], new Error("dup")), { code: "23505" });
    repo.findOne
      .mockResolvedValueOnce(null) // step 1: no known subject yet
      .mockResolvedValueOnce({ id: "idn-win", userId: "winner-1" }); // reload after conflict
    users.findByEmail.mockResolvedValue(null);
    users.findById.mockResolvedValue({ id: "winner-1", email: "brandnew@example.com" });
    repo.save.mockRejectedValueOnce(pgUnique); // our insert loses the race

    const result = await service.resolveUser({
      provider: "google",
      subject: "google-race",
      email: "brandnew@example.com",
      emailVerified: true,
    });

    expect(result).toEqual({ id: "winner-1", email: "brandnew@example.com" });
  });

  it("CONCURRENCY: linkToUser surfaces a conflict when another user won the race for the same subject", async () => {
    const pgUnique = Object.assign(new (require("typeorm").QueryFailedError)("q", [], new Error("dup")), { code: "23505" });
    repo.findOne
      .mockResolvedValueOnce(null) // no existing link when we check
      .mockResolvedValueOnce({ id: "idn-other", userId: "other-user" }); // reload: someone else won
    repo.save.mockRejectedValueOnce(pgUnique);

    await expect(
      service.linkToUser("user-1", { provider: "google", subject: "google-race-2", email: "real@example.com" }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it("linkToUser rejects when the identity is already linked to a different account", async () => {
    repo.findOne.mockResolvedValue({ id: "idn-2", userId: "someone-else" });

    await expect(
      service.linkToUser("user-1", { provider: "apple", subject: "apple-sub-42" }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it("linkToUser attaches a new identity to the current user", async () => {
    repo.findOne.mockResolvedValue(null);

    await service.linkToUser("user-1", {
      provider: "google",
      subject: "google-sub-1",
      email: "real@example.com",
    });

    expect(repo.save).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "user-1", provider: "google", providerSubject: "google-sub-1" }),
    );
  });

  it("getLinkedProviders returns unique providers for a user", async () => {
    repo.find.mockResolvedValue([
      { provider: "google" },
      { provider: "apple" },
      { provider: "google" },
    ]);
    await expect(service.getLinkedProviders("user-1")).resolves.toEqual(["google", "apple"]);
  });

  it("getConnections exposes provider email + relay flag + dates (one per provider)", async () => {
    const now = new Date("2026-03-01T10:00:00.000Z");
    repo.find.mockResolvedValue([
      { provider: "apple", providerEmail: "relay@privaterelay.appleid.com", providerEmailIsPrivateRelay: true, createdAt: now, lastAuthenticatedAt: null },
      { provider: "google", providerEmail: "g@example.com", providerEmailIsPrivateRelay: false, createdAt: now, lastAuthenticatedAt: now },
      // Duplicate google row must be collapsed.
      { provider: "google", providerEmail: "g@example.com", providerEmailIsPrivateRelay: false, createdAt: now, lastAuthenticatedAt: now },
    ]);

    const result = await service.getConnections("user-1");

    expect(result).toEqual([
      { provider: "apple", email: "relay@privaterelay.appleid.com", isPrivateRelay: true, connectedAt: now.toISOString(), lastAuthenticatedAt: null },
      { provider: "google", email: "g@example.com", isPrivateRelay: false, connectedAt: now.toISOString(), lastAuthenticatedAt: now.toISOString() },
    ]);
  });

  it("unlink deletes every row for (user, provider) and returns the count", async () => {
    repo.delete.mockResolvedValue({ affected: 1 });
    await expect(service.unlink("user-1", "google")).resolves.toBe(1);
    expect(repo.delete).toHaveBeenCalledWith({ userId: "user-1", provider: "google" });
  });
});
