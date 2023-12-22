import { ErrorObject } from "ajv";
import Ajv, { JTDDataType } from "ajv/dist/jtd";
import path from "path";
import { loadJson } from "./file-utils";

const mapSchema = {
  properties: {
    width: { type: "int32" },
    height: { type: "int32" },
    startPosition: {
      properties: {
        x: { type: "int32" },
        y: { type: "int32" },
      },
    },
    spriteSheet: { type: "string" },
  },
} as const;

const ajv = new Ajv();
const validate = ajv.compile<MapMetadata>(mapSchema);

export type MapMetadata = JTDDataType<typeof mapSchema>;

function validateMapMetadata(metadata: Object):
  | {
      ok: true;
      metadata: MapMetadata;
    }
  | { ok: false; errors: ErrorObject<string, Record<string, any>, unknown>[] } {
  if (validate(metadata)) {
    return { ok: true, metadata: metadata as MapMetadata };
  } else {
    return { ok: false, errors: validate.errors! };
  }
}


export async function loadMapMetadata(
  mapAssetsRoot: string,
  map: string
): Promise<
  | { ok: true; metadata: MapMetadata }
  | { ok: false; errors: ErrorObject<string, Record<string, any>, unknown>[] }
> {
  const metadataPath = path.join(mapAssetsRoot, map, "metadata.json");
  const metadata = await loadJson(metadataPath);
  if (!metadata.ok) {
    return { ok: false, errors: [] };
  }

  return validateMapMetadata(metadata.data);
}
