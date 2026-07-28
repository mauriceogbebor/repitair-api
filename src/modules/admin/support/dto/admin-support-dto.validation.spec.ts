import "reflect-metadata";
import { plainToInstance } from "class-transformer";
import { validateSync } from "class-validator";
import { AdminAddSupportTicketNoteDto } from "./admin-add-support-ticket-note.dto";
import { AdminCreateSupportTicketDto } from "./admin-create-support-ticket.dto";
import { AdminUpdateSupportTicketDto } from "./admin-update-support-ticket.dto";

function errorsFor<T extends object>(cls: new () => T, payload: Record<string, unknown>) {
  return validateSync(plainToInstance(cls, payload), { whitelist: true, forbidNonWhitelisted: false });
}

describe("Support DTO validation (independent of the frontend)", () => {
  it("rejects a whitespace-only internal note", () => {
    expect(errorsFor(AdminAddSupportTicketNoteDto, { body: "   " }).length).toBeGreaterThan(0);
  });

  it("rejects an oversized internal note", () => {
    expect(errorsFor(AdminAddSupportTicketNoteDto, { body: "x".repeat(5001) }).length).toBeGreaterThan(0);
  });

  it("accepts a valid internal note (and trims it)", () => {
    const dto = plainToInstance(AdminAddSupportTicketNoteDto, { body: "  a real note  " });
    expect(validateSync(dto).length).toBe(0);
    expect(dto.body).toBe("a real note");
  });

  it("rejects an empty subject and empty message on create", () => {
    const errors = errorsFor(AdminCreateSupportTicketDto, { name: "QA", email: "qa@example.com", subject: "  ", message: "" });
    const props = errors.map((error) => error.property);
    expect(props).toEqual(expect.arrayContaining(["subject", "message"]));
  });

  it("rejects a malformed related user identifier", () => {
    const errors = errorsFor(AdminCreateSupportTicketDto, { name: "QA", email: "qa@example.com", subject: "A subject", message: "Body", relatedUserId: "not-a-uuid" });
    expect(errors.map((error) => error.property)).toContain("relatedUserId");
  });

  it("rejects non-UUID items in related Repit identifiers", () => {
    const errors = errorsFor(AdminUpdateSupportTicketDto, { relatedRepitIds: ["11111111-1111-4111-8111-111111111111", "bad"] });
    expect(errors.map((error) => error.property)).toContain("relatedRepitIds");
  });

  it("rejects oversized / non-string tags", () => {
    const errors = errorsFor(AdminUpdateSupportTicketDto, { tags: ["x".repeat(51)] });
    expect(errors.map((error) => error.property)).toContain("tags");
  });
});
