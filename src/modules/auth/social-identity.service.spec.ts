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

  const linkedUser = { id: "user-1", email: "real@example.com" };
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

  it("links an unknown subject to an existing user when a real (non-relay) email matches", async () => {
    repo.findOne.mockResolvedValue(null);
    users.findByEmail.mockResolvedValue(linkedUser);

    const result = await service.resolveUser({
      provider: "google",
      subject: "google-sub-7",
      email: "real@example.com",
      picture: "https://pic",
    });

    expect(users.findByEmail).toHaveBeenCalledWith("real@example.com");
    expect(users.createSocialUser).not.toHaveBeenCalled();
    expect(users.setAvatarIfMissing).toHaveBeenCalledWith("user-1", "https://pic");
    expect(result).toBe(linkedUser);
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
