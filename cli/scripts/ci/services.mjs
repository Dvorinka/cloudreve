import assert from "node:assert/strict";
import { docker } from "./docker-fixture.mjs";

export function selectSearchImage(definition, architecture) {
  const platforms = {
    aarch64: "linux/arm64",
    arm64: "linux/arm64",
    x86_64: "linux/amd64",
    amd64: "linux/amd64",
  };

  const platform = platforms[architecture];

  assert(platform, "Unsupported Docker daemon architecture for the search helper");

  const image = definition.platforms[platform];

  assert.match(image, /^getmeili\/meilisearch@sha256:[a-f0-9]{64}$/);

  return { image, platform };
}

/** Optional indexer services, scoped to the fixture's private Docker network. */
export async function services(io, fixture, sdk, images) {
  const request = sdk.session.request.bind(sdk.session);

  const set = async (values) => {
    for (const [key, value] of Object.entries(values)) {
      await request("/api/v4/admin/settings", {
        method: "PATCH",
        body: JSON.stringify({ settings: { [key]: value } }),
      });
    }
  };

  const search = await io.service(fixture, {
    name: "search",
    ...selectSearchImage(images.search, docker(["info", "--format", "{{.Architecture}}"])),
    port: 7700,
    health: "/health",
    environment: { MEILI_ENV: "development", MEILI_NO_ANALYTICS: "true" },
  });

  const extractor = await io.service(fixture, {
    name: "extractor",
    image: images.extractor,
    port: 9998,
    health: "/version",
  });

  const versionResponse = await fetch(search.endpoint + "/version", {
    signal: AbortSignal.timeout(10000),
    redirect: "error",
  });

  assert(versionResponse.ok, "Search helper version discovery failed");

  const version = await versionResponse.json();

  assert.equal(version.pkgVersion, images.search.version);
  assert.equal(search.revision, images.search.revision);

  await set({
    register_enabled: "1",
    email_active: "0",
    fts_enabled: "1",
    fts_index_type: "meilisearch",
    fts_extractor_type: "tika",
    fts_meilisearch_endpoint: `http://${search.alias}:7700`,
    fts_tika_endpoint: `http://${extractor.alias}:9998`,
    fts_tika_exts: "txt,md",
    fs_event_push_enabled: "1",
    fs_event_push_debounce: "1",
    use_sse_for_search: "0",
  });

  return {
    search: search.endpoint,
    extractor: extractor.endpoint,
    set,
    auxiliaries: [
      {
        name: "meilisearch",
        image: search.image,
        imageId: search.imageId,
        platform: search.platform,
        version: version.pkgVersion,
        revision: search.revision,
      },
      {
        name: "tika",
        image: extractor.image,
        imageId: extractor.imageId,
        platform: extractor.platform,
      },
    ],
  };
}
