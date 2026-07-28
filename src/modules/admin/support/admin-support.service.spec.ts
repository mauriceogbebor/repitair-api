import { ConflictException, NotFoundException, ServiceUnavailableException } from "@nestjs/common";
import { ContactSubmission, SupportTicketNote, SupportTicketResponse } from "../../../entities";
import { AdminSupportService } from "./admin-support.service";

describe("AdminSupportService", () => {
  const ticket = {
    id: "57a8cb04-228d-4d54-8b20-6f54a9d2236d",
    name: "QA User",
    email: "qa@example.com",
    subject: "Playback issue",
    message: "The export did not complete",
    status: "open",
    priority: "high",
    category: "technical",
    tags: [],
    assignedAdminUserId: null,
    assignedAdminEmail: null,
    relatedUserId: null,
    relatedRepitIds: [],
    relatedNotificationIds: [],
    firstResponseDueAt: new Date(Date.now() + 60_000),
    firstRespondedAt: null,
    resolutionDueAt: new Date(Date.now() + 60_000),
    resolvedAt: null,
    closedAt: null,
    source: "contact_form",
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const ticketRepository = { findOne: jest.fn(), save: jest.fn(), create: jest.fn((value) => ({ id: "new-ticket-id", ...value })), createQueryBuilder: jest.fn() };
  const responseRepository = { findOne: jest.fn(), create: jest.fn((value) => ({ id: "response-id", ...value })), save: jest.fn(), count: jest.fn() };
  const noteRepository = { findOne: jest.fn(), create: jest.fn((value) => ({ id: "note-id", ...value })), save: jest.fn() };
  const auditLogsService = { append: jest.fn() };
  const mailService = { sendRaw: jest.fn() };
  const managerRepos = new Map<unknown, unknown>([
    [ContactSubmission, ticketRepository],
    [SupportTicketResponse, responseRepository],
    [SupportTicketNote, noteRepository],
  ]);
  const manager = { getRepository: jest.fn((entity: unknown) => managerRepos.get(entity) ?? ticketRepository) };
  const dataSource = { transaction: jest.fn(async (callback: (m: typeof manager) => unknown) => callback(manager)) };

  const service = new AdminSupportService(
    ticketRepository as never, noteRepository as never, responseRepository as never,
    {} as never, {} as never, {} as never, {} as never, {} as never, {} as never, {} as never,
    {} as never, {} as never, {} as never, {} as never,
    dataSource as never, auditLogsService as never, mailService as never,
  );

  const KEY = "51e2b7fa-733a-41b5-8faf-23b17f4cafab";

  beforeEach(() => {
    jest.clearAllMocks();
    ticketRepository.findOne.mockResolvedValue({ ...ticket });
    ticketRepository.save.mockImplementation(async (value) => value);
    responseRepository.findOne.mockResolvedValue(null);
    responseRepository.save.mockImplementation(async (value) => value);
    responseRepository.count.mockResolvedValue(0);
    noteRepository.save.mockImplementation(async (value) => value);
    auditLogsService.append.mockResolvedValue({});
    dataSource.transaction.mockImplementation(async (callback: (m: typeof manager) => unknown) => callback(manager));
    jest.spyOn(service, "getTicketDetail").mockResolvedValue({ id: ticket.id } as never);
  });

  afterEach(() => jest.restoreAllMocks());

  // ── Original behaviours ────────────────────────────────────────────────────
  it("records provider acceptance without claiming delivery", async () => {
    mailService.sendRaw.mockResolvedValue(undefined);
    const result = await service.respond(ticket.id, { body: "We are investigating.", idempotencyKey: KEY });
    expect(mailService.sendRaw).toHaveBeenCalledTimes(1);
    expect(responseRepository.save).toHaveBeenLastCalledWith(expect.objectContaining({ status: "sent_to_provider" }));
    expect(ticketRepository.save).toHaveBeenCalledWith(expect.objectContaining({ status: "waiting_for_customer" }));
    expect(auditLogsService.append).toHaveBeenCalledWith(expect.objectContaining({ action: "admin.support.response_sent" }), manager);
    expect((result as { responseDelivery?: { outcome: string } }).responseDelivery?.outcome).toBe("accepted");
  });

  it("stores failed/provider_failure on a confirmed provider rejection", async () => {
    mailService.sendRaw.mockRejectedValue(new Error("SMTP unavailable"));
    await expect(service.respond(ticket.id, { body: "Investigating.", idempotencyKey: KEY })).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(responseRepository.save).toHaveBeenLastCalledWith(expect.objectContaining({ status: "failed", failureCategory: "provider_failure" }));
    // The queued attempt was created on the response repository, not the case repository.
    expect(ticketRepository.save).not.toHaveBeenCalled();
  });

  it("rejects unsupported lifecycle transitions", async () => {
    ticketRepository.findOne.mockResolvedValue({ ...ticket, status: "closed" });
    await expect(service.updateStatus(ticket.id, { status: "open", reason: "User replied" })).rejects.toBeInstanceOf(ConflictException);
  });

  it("omits PII from list records when the actor lacks permission", () => {
    const serialized = (service as unknown as { serializeListItem: (r: typeof ticket, p: boolean, e: boolean) => { userEmail: string | null } }).serializeListItem(ticket, false, false);
    expect(serialized.userEmail).toBeNull();
  });

  it("derives breached SLA state on the server", () => {
    const breached = { ...ticket, firstResponseDueAt: new Date(Date.now() - 60_000), resolutionDueAt: new Date(Date.now() + 60_000), firstRespondedAt: null };
    const sla = (service as unknown as { deriveSla: (r: typeof ticket) => { state: string } }).deriveSla(breached);
    expect(sla.state).toBe("breached");
  });

  // ── Failed-retry lifecycle ─────────────────────────────────────────────────
  it("retries a failed attempt by calling the provider exactly once and updating the same row", async () => {
    responseRepository.findOne.mockResolvedValue({ id: "response-id", ticketId: ticket.id, status: "failed", failureCategory: "provider_failure" });
    mailService.sendRaw.mockResolvedValue(undefined);
    const result = await service.respond(ticket.id, { body: "Retrying.", idempotencyKey: KEY });
    expect(mailService.sendRaw).toHaveBeenCalledTimes(1);
    expect(responseRepository.create).not.toHaveBeenCalled(); // no new row
    expect(responseRepository.save).toHaveBeenLastCalledWith(expect.objectContaining({ id: "response-id", status: "sent_to_provider" }));
    expect(auditLogsService.append).toHaveBeenCalledWith(expect.objectContaining({ action: "admin.support.response_retry_accepted" }), manager);
    expect((result as { responseDelivery?: { outcome: string } }).responseDelivery?.outcome).toBe("accepted");
  });

  it("keeps a rejected retry failed and safely retryable, without a new row", async () => {
    responseRepository.findOne.mockResolvedValue({ id: "response-id", ticketId: ticket.id, status: "failed", failureCategory: "provider_failure" });
    mailService.sendRaw.mockRejectedValue(new Error("SMTP down again"));
    await expect(service.respond(ticket.id, { body: "Retrying.", idempotencyKey: KEY })).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(responseRepository.create).not.toHaveBeenCalled();
    expect(responseRepository.save).toHaveBeenLastCalledWith(expect.objectContaining({ status: "failed", failureCategory: "provider_failure" }));
  });

  // ── Replay + concurrency ───────────────────────────────────────────────────
  it("returns idempotent success for an already-accepted attempt without contacting the provider", async () => {
    responseRepository.findOne.mockResolvedValue({ id: "response-id", ticketId: ticket.id, status: "sent_to_provider" });
    const result = await service.respond(ticket.id, { body: "Investigating.", idempotencyKey: KEY });
    expect(mailService.sendRaw).not.toHaveBeenCalled();
    expect(responseRepository.save).not.toHaveBeenCalled();
    expect((result as { responseDelivery?: { outcome: string } }).responseDelivery?.outcome).toBe("already_accepted");
  });

  it("does not report success for a queued (in-progress) attempt", async () => {
    responseRepository.findOne.mockResolvedValue({ id: "response-id", ticketId: ticket.id, status: "queued" });
    await expect(service.respond(ticket.id, { body: "Investigating.", idempotencyKey: KEY })).rejects.toBeInstanceOf(ConflictException);
    expect(mailService.sendRaw).not.toHaveBeenCalled();
  });

  it("returns 409 for a cross-case idempotency-key collision", async () => {
    responseRepository.findOne.mockResolvedValue({ id: "response-id", ticketId: "other-ticket", status: "sent_to_provider" });
    await expect(service.respond(ticket.id, { body: "Investigating.", idempotencyKey: KEY })).rejects.toBeInstanceOf(ConflictException);
    expect(mailService.sendRaw).not.toHaveBeenCalled();
  });

  it("rolls back the queued attempt and does NOT contact the provider when the pre-send audit fails", async () => {
    auditLogsService.append.mockRejectedValueOnce(new Error("audit unavailable"));
    await expect(service.respond(ticket.id, { body: "Investigating.", idempotencyKey: KEY })).rejects.toThrow("audit unavailable");
    expect(mailService.sendRaw).not.toHaveBeenCalled();
  });

  it("blocks a concurrent duplicate initial submission (unique-index race) without a second send", async () => {
    responseRepository.findOne.mockResolvedValueOnce(null).mockResolvedValueOnce({ id: "response-id", ticketId: ticket.id, status: "queued" });
    dataSource.transaction.mockRejectedValueOnce(Object.assign(new Error("duplicate key"), { code: "23505" }));
    await expect(service.respond(ticket.id, { body: "Investigating.", idempotencyKey: KEY })).rejects.toBeInstanceOf(ConflictException);
    expect(mailService.sendRaw).not.toHaveBeenCalled();
  });

  it("blocks a concurrent retry (attempt already claimed) without a second send", async () => {
    responseRepository.findOne.mockResolvedValueOnce({ id: "response-id", ticketId: ticket.id, status: "failed", failureCategory: "provider_failure" }).mockResolvedValueOnce({ id: "response-id", ticketId: ticket.id, status: "queued" });
    await expect(service.respond(ticket.id, { body: "Retrying.", idempotencyKey: KEY })).rejects.toBeInstanceOf(ConflictException);
    expect(mailService.sendRaw).not.toHaveBeenCalled();
  });

  it("does NOT downgrade the response when post-acceptance bookkeeping fails", async () => {
    mailService.sendRaw.mockResolvedValue(undefined);
    ticketRepository.save.mockRejectedValueOnce(new Error("db write failed"));
    await expect(service.respond(ticket.id, { body: "Investigating.", idempotencyKey: KEY })).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(responseRepository.save).toHaveBeenCalledWith(expect.objectContaining({ status: "sent_to_provider" }));
    expect(responseRepository.save).not.toHaveBeenCalledWith(expect.objectContaining({ failureCategory: "provider_failure" }));
  });

  it("returns an uncertain result (not a resend prompt) when acceptance cannot be recorded", async () => {
    mailService.sendRaw.mockResolvedValue(undefined);
    // First save (queued, inside the claim txn) succeeds; the sent_to_provider save fails.
    responseRepository.save.mockImplementationOnce(async (value) => value).mockRejectedValueOnce(new Error("status write failed"));
    await expect(service.respond(ticket.id, { body: "Investigating.", idempotencyKey: KEY })).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(responseRepository.save).not.toHaveBeenCalledWith(expect.objectContaining({ failureCategory: "provider_failure" }));
  });

  // ── Transactional case-mutation audit (retained coverage) ──────────────────
  it("rolls back a classification change when the audit write fails", async () => {
    auditLogsService.append.mockRejectedValueOnce(new Error("audit unavailable"));
    await expect(service.classifyTicket(ticket.id, { category: "billing" })).rejects.toThrow("audit unavailable");
  });

  it("rolls back an internal note when the audit write fails", async () => {
    auditLogsService.append.mockRejectedValueOnce(new Error("audit unavailable"));
    await expect(service.addNote(ticket.id, { body: "Investigation note" })).rejects.toThrow("audit unavailable");
  });

  it("accepts a valid lifecycle transition", async () => {
    ticketRepository.findOne.mockResolvedValue({ ...ticket, status: "open" });
    await expect(service.updateStatus(ticket.id, { status: "assigned", reason: "Picked up" })).resolves.toBeDefined();
    expect(ticketRepository.save).toHaveBeenCalledWith(expect.objectContaining({ status: "assigned" }));
  });

  // ── Delivery truth survives case-detail hydration failure (Finding 2) ──────
  it("still confirms acceptance when case-detail hydration fails after a send", async () => {
    mailService.sendRaw.mockResolvedValue(undefined);
    (service.getTicketDetail as jest.Mock).mockRejectedValueOnce(new Error("hydration failed"));
    const result = await service.respond(ticket.id, { body: "Investigating.", idempotencyKey: KEY });
    expect(result.responseDelivery).toEqual(expect.objectContaining({ outcome: "accepted", status: "sent_to_provider" }));
    expect((result as { caseDetail?: unknown }).caseDetail).toBeUndefined();
  });

  it("still confirms an already-accepted replay when case-detail hydration fails", async () => {
    responseRepository.findOne.mockResolvedValue({ id: "response-id", ticketId: ticket.id, status: "sent_to_provider" });
    (service.getTicketDetail as jest.Mock).mockRejectedValueOnce(new Error("hydration failed"));
    const result = await service.respond(ticket.id, { body: "Investigating.", idempotencyKey: KEY });
    expect(result.responseDelivery).toEqual(expect.objectContaining({ outcome: "already_accepted" }));
    expect((result as { caseDetail?: unknown }).caseDetail).toBeUndefined();
    expect(mailService.sendRaw).not.toHaveBeenCalled();
  });

  // ── Reconciliation (no provider call) ──────────────────────────────────────
  it("reconciles an accepted attempt as already_accepted with sending disallowed", async () => {
    responseRepository.findOne.mockResolvedValue({ id: "response-id", ticketId: ticket.id, status: "sent_to_provider", idempotencyKey: KEY, createdAt: new Date() });
    const r = await service.getResponseAttemptStatus(ticket.id, "response-id");
    expect(r).toEqual(expect.objectContaining({ deliveryOutcome: "already_accepted", sendAllowed: false, retryable: false }));
    expect(mailService.sendRaw).not.toHaveBeenCalled();
  });

  it("reconciles a failed attempt as rejected and retryable", async () => {
    responseRepository.findOne.mockResolvedValue({ id: "response-id", ticketId: ticket.id, status: "failed", failureCategory: "provider_failure", idempotencyKey: KEY, createdAt: new Date() });
    const r = await service.getResponseAttemptStatus(ticket.id, "response-id");
    expect(r).toEqual(expect.objectContaining({ deliveryOutcome: "rejected", sendAllowed: true, retryable: true }));
  });

  it("reconciles a fresh queued attempt as in_progress (blocked)", async () => {
    responseRepository.findOne.mockResolvedValue({ id: "response-id", ticketId: ticket.id, status: "queued", idempotencyKey: KEY, createdAt: new Date() });
    const r = await service.getResponseAttemptStatus(ticket.id, "response-id");
    expect(r).toEqual(expect.objectContaining({ deliveryOutcome: "in_progress", sendAllowed: false }));
  });

  it("reconciles a STALE queued attempt as uncertain via a server-derived rule (blocked)", async () => {
    responseRepository.findOne.mockResolvedValue({ id: "response-id", ticketId: ticket.id, status: "queued", idempotencyKey: KEY, createdAt: new Date(Date.now() - 20 * 60 * 1000) });
    const r = await service.getResponseAttemptStatus(ticket.id, "response-id");
    expect(r).toEqual(expect.objectContaining({ deliveryOutcome: "uncertain", sendAllowed: false }));
  });

  it("rejects reconciliation of an attempt belonging to another case", async () => {
    responseRepository.findOne.mockResolvedValue({ id: "response-id", ticketId: "other-ticket", status: "sent_to_provider", idempotencyKey: KEY, createdAt: new Date() });
    await expect(service.getResponseAttemptStatus(ticket.id, "response-id")).rejects.toBeInstanceOf(NotFoundException);
  });

  it("never exposes the raw idempotency key in a reconciliation result", async () => {
    responseRepository.findOne.mockResolvedValue({ id: "response-id", ticketId: ticket.id, status: "queued", idempotencyKey: KEY, createdAt: new Date() });
    const r = await service.getResponseAttemptStatus(ticket.id, "response-id");
    expect(r.idempotencyReference).not.toBe(KEY);
    expect(r.idempotencyReference).toHaveLength(16);
  });

  // ── Server-side single-inflight guarantee (Finding 1: multi-tab/refresh) ───
  it("rejects a NEW key while an unresolved queued attempt exists for the case (no second send)", async () => {
    // Pre-check by key finds nothing; the in-flight check under the case lock finds
    // a queued attempt created under a DIFFERENT key.
    responseRepository.findOne.mockResolvedValueOnce(null).mockResolvedValueOnce({ id: "inflight-id", ticketId: ticket.id, status: "queued", idempotencyKey: "other-key" });
    await expect(service.respond(ticket.id, { body: "Second tab send.", idempotencyKey: "88888888-8888-4888-8888-888888888888" })).rejects.toBeInstanceOf(ConflictException);
    expect(mailService.sendRaw).not.toHaveBeenCalled();
    expect(responseRepository.create).not.toHaveBeenCalled();
    const blockedAudit = auditLogsService.append.mock.calls.find(([input]) => input.action === "admin.support.response_concurrent_blocked");
    expect(blockedAudit).toHaveLength(1); // persisted outside the rolled-back claim transaction
  });

  it("revalidates terminal case state under the parent lock before provider contact", async () => {
    ticketRepository.findOne.mockResolvedValue({ ...ticket, status: "resolved" });
    await expect(service.respond(ticket.id, { body: "Too late.", idempotencyKey: KEY })).rejects.toBeInstanceOf(ConflictException);
    expect(mailService.sendRaw).not.toHaveBeenCalled();
    expect(responseRepository.create).not.toHaveBeenCalled();
  });

  it("serializes a failed retry behind another queued attempt for the case", async () => {
    const failed = { id: "response-id", ticketId: ticket.id, status: "failed", failureCategory: "provider_failure" };
    const inflight = { id: "other-response-id", ticketId: ticket.id, status: "queued", idempotencyKey: "other-key" };
    responseRepository.findOne.mockResolvedValueOnce(failed).mockResolvedValueOnce(failed).mockResolvedValueOnce(inflight);
    await expect(service.respond(ticket.id, { body: "Retrying.", idempotencyKey: KEY })).rejects.toBeInstanceOf(ConflictException);
    expect(mailService.sendRaw).not.toHaveBeenCalled();
    expect(responseRepository.save).not.toHaveBeenCalledWith(expect.objectContaining({ id: "response-id", status: "queued" }));
  });

  it("preserves a terminal state committed after provider acceptance", async () => {
    ticketRepository.findOne.mockResolvedValueOnce({ ...ticket, status: "open" }).mockResolvedValueOnce({ ...ticket, status: "resolved", resolvedAt: new Date() });
    mailService.sendRaw.mockResolvedValue(undefined);
    await service.respond(ticket.id, { body: "Accepted while resolving.", idempotencyKey: KEY });
    expect(ticketRepository.save).toHaveBeenLastCalledWith(expect.objectContaining({ status: "resolved" }));
    expect(ticketRepository.save).not.toHaveBeenCalledWith(expect.objectContaining({ status: "waiting_for_customer", resolvedAt: expect.any(Date) }));
  });

  it("blocks resolution while a response attempt is queued", async () => {
    responseRepository.count.mockResolvedValueOnce(1);
    await expect(service.resolveTicket(ticket.id, { resolutionCategory: "answered", resolutionSummary: "Resolved" })).rejects.toBeInstanceOf(ConflictException);
    expect(ticketRepository.save).not.toHaveBeenCalled();
  });

  it("uses truthful timeline labels for every response delivery state", () => {
    const label = (status: SupportTicketResponse["status"], failureCategory: SupportTicketResponse["failureCategory"] = null) =>
      (service as unknown as { responseTimelineLabel: (response: Pick<SupportTicketResponse, "status" | "failureCategory">) => string }).responseTimelineLabel({ status, failureCategory });
    expect(label("queued")).toBe("Response queued");
    expect(label("sent_to_provider")).toBe("Response sent to provider");
    expect(label("delivery_unknown", "migration_duplicate_uncertain")).toBe("Response delivery unconfirmed");
    expect(label("failed", "provider_failure")).toBe("Response rejected by provider");
  });

  // ── Staleness uses the latest claim time, not createdAt (Finding 2) ────────
  it("does not classify a freshly re-claimed (retried) old attempt as stale", async () => {
    responseRepository.findOne.mockResolvedValue({ id: "response-id", ticketId: ticket.id, status: "queued", idempotencyKey: KEY, createdAt: new Date(Date.now() - 60 * 60 * 1000), lastAttemptAt: new Date() });
    const r = await service.getResponseAttemptStatus(ticket.id, "response-id");
    expect(r.deliveryOutcome).toBe("in_progress");
  });
});
