import { Test, TestingModule } from "@nestjs/testing";
import { getRepositoryToken } from "@nestjs/typeorm";
import { ConfigService } from "@nestjs/config";

import { ContactService } from "./contact.service";
import { ContactSubmission } from "../../entities";
import { MailService } from "../../common/services/mail.service";

describe("ContactService", () => {
  let service: ContactService;
  const mockRepo = {
    create: jest.fn(),
    save: jest.fn(),
  };
  const mockMailService = {
    sendRaw: jest.fn(),
  };
  const mockConfig = {
    get: jest.fn().mockReturnValue("support@test.com"),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ContactService,
        { provide: getRepositoryToken(ContactSubmission), useValue: mockRepo },
        { provide: MailService, useValue: mockMailService },
        { provide: ConfigService, useValue: mockConfig },
      ],
    }).compile();

    service = module.get<ContactService>(ContactService);
  });

  afterEach(() => jest.clearAllMocks());

  it("should persist submission to database", async () => {
    const dto = {
      name: "Test User",
      email: "test@example.com",
      subject: "Hello",
      message: "Test message",
    };
    const savedEntity = { id: "uuid-1", ...dto, emailSent: false };
    mockRepo.create.mockReturnValue(savedEntity);
    mockRepo.save.mockResolvedValue(savedEntity);
    mockMailService.sendRaw.mockResolvedValue(undefined);

    const result = await service.submit(dto);

    expect(mockRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({ name: "Test User", email: "test@example.com" }),
    );
    expect(mockRepo.save).toHaveBeenCalled();
    expect(result).toBeDefined();
  });

  it("should still persist even if email fails", async () => {
    const dto = {
      name: "Test",
      email: "test@example.com",
      subject: "Subject",
      message: "Message",
    };
    const savedEntity = { id: "uuid-2", ...dto, emailSent: false };
    mockRepo.create.mockReturnValue(savedEntity);
    mockRepo.save.mockResolvedValue(savedEntity);
    mockMailService.sendRaw.mockRejectedValue(new Error("SMTP error"));

    const result = await service.submit(dto);

    expect(result).toBeDefined();
    expect(mockRepo.create).toHaveBeenCalled();
  });
});
