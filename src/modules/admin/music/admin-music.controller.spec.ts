import { ADMIN_REQUIRED_PERMISSIONS_KEY } from "../admin.constants";
import type { AdminRequest } from "../admin.types";
import { AdminMusicController } from "./admin-music.controller";

describe("AdminMusicController", () => {
  const request = {
    adminUser: {
      id: "admin-1",
      email: "operator@example.test",
      fullName: "Music Operator",
      status: "active",
      roleKeys: ["support-admin"],
      permissionKeys: ["music.read", "music.manage"],
    },
    adminRequestContext: {
      requestId: "request-1",
      ipAddress: null,
      userAgent: null,
      method: "POST",
      path: "/admin/music/users/user-1/spotify/require-reauth",
    },
  } as AdminRequest;

  it("declares least-privilege read and manage permissions", () => {
    expect(Reflect.getMetadata(
      ADMIN_REQUIRED_PERMISSIONS_KEY,
      AdminMusicController.prototype.overview,
    )).toEqual(["music.read"]);
    expect(Reflect.getMetadata(
      ADMIN_REQUIRED_PERMISSIONS_KEY,
      AdminMusicController.prototype.requireReauthorization,
    )).toEqual(["music.manage"]);
    expect(Reflect.getMetadata(
      ADMIN_REQUIRED_PERMISSIONS_KEY,
      AdminMusicController.prototype.disconnect,
    )).toEqual(["music.manage"]);
  });

  it("audits forced reauthorization without credential material", async () => {
    const music = {
      requireReauthorization: jest.fn().mockResolvedValue({
        targetId: "connection-1",
        before: { status: "connected" },
        connection: { id: "connection-1", status: "reauth_required", provider: "spotify" },
      }),
    };
    const auditLogs = { append: jest.fn().mockResolvedValue(undefined) };
    const controller = new AdminMusicController(music as never, auditLogs as never);

    await controller.requireReauthorization(
      { userId: "8df9b450-e91b-44db-b262-2701ee149986", provider: "spotify" as never },
      request,
    );

    expect(auditLogs.append).toHaveBeenCalledWith({
      action: "admin.music.reauthorization_required",
      actor: request.adminUser,
      context: request.adminRequestContext,
      targetType: "music_connection",
      targetId: "connection-1",
      beforeState: { status: "connected" },
      afterState: { status: "reauth_required" },
      metadata: {
        userId: "8df9b450-e91b-44db-b262-2701ee149986",
        provider: "spotify",
      },
    });
    expect(JSON.stringify(auditLogs.append.mock.calls)).not.toMatch(/token|secret|credential/i);
  });

  it("audits disconnect and returns only the operational result", async () => {
    const music = {
      disconnect: jest.fn().mockResolvedValue({
        targetId: "connection-1",
        before: { status: "connected" },
        disconnected: true,
        userId: "8df9b450-e91b-44db-b262-2701ee149986",
        provider: "apple-music",
      }),
    };
    const auditLogs = { append: jest.fn().mockResolvedValue(undefined) };
    const controller = new AdminMusicController(music as never, auditLogs as never);

    const result = await controller.disconnect(
      { userId: "8df9b450-e91b-44db-b262-2701ee149986", provider: "apple-music" as never },
      request,
    );

    expect(result).toEqual({
      disconnected: true,
      userId: "8df9b450-e91b-44db-b262-2701ee149986",
      provider: "apple-music",
    });
    expect(auditLogs.append).toHaveBeenCalledWith(expect.objectContaining({
      action: "admin.music.disconnected",
      beforeState: { status: "connected" },
      afterState: { status: "disconnected" },
    }));
  });
});
