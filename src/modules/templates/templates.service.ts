import { Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { Template } from "../../entities/template.entity";

@Injectable()
export class TemplatesService {
  constructor(
    @InjectRepository(Template)
    private readonly repo: Repository<Template>,
  ) {}

  findAll() {
    return this.repo.find({ order: { sortOrder: "ASC" } });
  }
}
