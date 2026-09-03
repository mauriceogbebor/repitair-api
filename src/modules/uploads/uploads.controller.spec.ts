import { NotFoundException } from "@nestjs/common";
import { Response } from "express";
import { UploadsController } from "./uploads.controller";
import { UploadsService } from "./uploads.service";

describe("UploadsController", () => {
  const uploadsService = {
    readFile: jest.fn(),
  };
  let controller: UploadsController;

  beforeEach(() => {
    jest.clearAllMocks();
    controller = new UploadsController(uploadsService as unknown as UploadsService);
  });

  it("serves stored provider bytes through the durable upload route", async () => {
    const file = Buffer.from("image bytes");
    const response = {
      send: jest.fn(),
      setHeader: jest.fn(),
    } as unknown as Response;
    uploadsService.readFile.mockResolvedValue(file);

    await controller.serveFile("photo.png", response);

    expect(uploadsService.readFile).toHaveBeenCalledWith("photo.png");
    expect(response.setHeader).toHaveBeenCalledWith("Content-Type", "image/png");
    expect(response.setHeader).toHaveBeenCalledWith(
      "Cache-Control",
      "public, max-age=31536000, immutable",
    );
    expect(response.send).toHaveBeenCalledWith(file);
  });

  it.each([
    ["photo.heic", "image/heic"],
    ["photo.heif", "image/heif"],
  ])("serves iOS image %s with its correct content type", async (filename, contentType) => {
    const response = {
      send: jest.fn(),
      setHeader: jest.fn(),
    } as unknown as Response;
    uploadsService.readFile.mockResolvedValue(Buffer.from("image bytes"));

    await controller.serveFile(filename, response);

    expect(response.setHeader).toHaveBeenCalledWith("Content-Type", contentType);
  });

  it("rejects path traversal before reading storage", async () => {
    const response = {
      send: jest.fn(),
      setHeader: jest.fn(),
    } as unknown as Response;

    await expect(controller.serveFile("../secret", response)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(uploadsService.readFile).not.toHaveBeenCalled();
  });
});
