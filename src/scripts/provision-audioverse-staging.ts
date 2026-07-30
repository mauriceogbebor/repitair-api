import dataSource from "../data-source";
import { Template } from "../entities/template.entity";

const ALLOWED_ENVIRONMENTS = new Set(["staging", "qa", "pre-production", "preproduction"]);
const CONFIRMATION_FLAG = "--confirm-audioverse-staging";

async function provisionAudioverse(): Promise<void> {
  const appEnvironment = (process.env.APP_ENV ?? "").trim().toLowerCase();
  if (!ALLOWED_ENVIRONMENTS.has(appEnvironment)) {
    throw new Error(
      `Refusing to provision Audioverse: APP_ENV must identify staging/QA, received "${appEnvironment || "unset"}".`,
    );
  }
  if (!process.argv.includes(CONFIRMATION_FLAG)) {
    throw new Error(`Refusing to provision Audioverse without ${CONFIRMATION_FLAG}.`);
  }

  await dataSource.initialize();
  try {
    const repository = dataSource.getRepository(Template);
    const template = await repository.findOne({ where: { id: "audioverse" } });
    if (!template) {
      throw new Error('Audioverse template with stable key "audioverse" was not found.');
    }

    template.status = "published";
    template.isActive = true;
    template.capabilities = {
      ...(template.capabilities ?? {}),
      supportsIsolatedSubject: true,
      requiresBackgroundRemoval: true,
    };
    template.certificationMeta = {
      ...(template.certificationMeta ?? {}),
      status: "qa-review",
      reviewNotes: "Audioverse isolation enabled for staging device certification; not production-certified.",
      lastReviewedAt: new Date().toISOString(),
      lastReviewedBy: "audioverse-staging-provision",
    };

    const saved = await repository.save(template);
    console.log(JSON.stringify({
      appEnvironment,
      templateKey: saved.id,
      status: saved.status,
      isActive: saved.isActive,
      supportsIsolatedSubject: saved.capabilities?.supportsIsolatedSubject === true,
      requiresBackgroundRemoval: saved.capabilities?.requiresBackgroundRemoval === true,
      certificationStatus: saved.certificationMeta?.status ?? null,
      updatedAt: saved.updatedAt,
    }, null, 2));
  } finally {
    await dataSource.destroy();
  }
}

void provisionAudioverse().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "Unknown provisioning error";
  console.error(message);
  process.exitCode = 1;
});
