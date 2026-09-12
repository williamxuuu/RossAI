import { describe, expect, it } from "vitest";
import { deflateSync } from "node:zlib";
import {
  MIN_LONG_EDGE_PX,
  checkLegibility,
  classifyDocumentText,
  extractBlankFields,
  extractLabelledFields,
  imageDimensions,
  pngDimensions,
} from "./extract";

/**
 * The deterministic floor. This is what runs when there is no vision model, so it has
 * to be right about two things: it must catch a copy nobody could read, and it must
 * say "I don't know" rather than "fine" about everything else.
 */

/**
 * A minimal valid PNG — enough for the dimension reader, padded to `totalBytes` so
 * the file-size half of the legibility check sees a realistic figure. (Deflating a
 * run of identical bytes produces almost nothing, so the payload has to be padded
 * rather than merely allocated.)
 */
function png(width: number, height: number, totalBytes = 0): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    return Buffer.concat([len, Buffer.from(type, "latin1"), data, Buffer.alloc(4)]);
  };
  const base = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(Buffer.alloc(64, 7))),
  ]);
  const padding = Math.max(0, totalBytes - base.length);
  return Buffer.concat([base, Buffer.alloc(padding, 0x5a)]);
}

describe("image dimensions", () => {
  it("reads a PNG header", () => {
    expect(pngDimensions(png(1400, 900))).toEqual({ width: 1400, height: 900 });
  });

  it("returns null for something that is not an image", () => {
    expect(imageDimensions(Buffer.from("%PDF-1.7\n"), "application/pdf")).toBeNull();
  });
});

describe("checkLegibility", () => {
  it("rejects a photo too small for the text to survive scanning", () => {
    const result = checkLegibility(png(240, 160, 40_000), "image/png");
    expect(result.legible).toBe(false);
    expect(result.reasonCode).toBe("too_small");
    expect(result.notes).toContain("240×160");
  });

  it("says 'I do not know' about a large photo rather than passing it", () => {
    // Nothing here can read the text in a photo; only the vision model or a person can.
    const result = checkLegibility(png(1400, 900, 200_000), "image/png");
    expect(result.legible).toBeNull();
    expect(result.notes).toContain("1400×900");
  });

  it("accepts a PDF with a real text layer and defers on a scan without one", () => {
    expect(checkLegibility(Buffer.from("%PDF"), "application/pdf", 600).legible).toBe(true);
    expect(checkLegibility(Buffer.from("%PDF"), "application/pdf", 0).legible).toBeNull();
  });

  it("does not accidentally reject a large image just under the long-edge floor", () => {
    expect(checkLegibility(png(MIN_LONG_EDGE_PX, 700, 200_000), "image/png").legible).toBeNull();
    expect(checkLegibility(png(MIN_LONG_EDGE_PX - 1, 700, 200_000), "image/png").legible).toBe(false);
  });
});

describe("extractLabelledFields", () => {
  it("reads label/value lines in English and Spanish", () => {
    const fields = extractLabelledFields(
      ["Nombre: Maria Elena Garcia Lopez", "Fecha de nacimiento: 14/03/1988", "Idioma: Espanol"].join("\n"),
    );
    expect(fields).toMatchObject({
      fullName: "Maria Elena Garcia Lopez",
      dateOfBirth: "14/03/1988",
      language: "Espanol",
    });
  });

  it("takes the first value for a field, so a parent's name does not overwrite the holder's", () => {
    const fields = extractLabelledFields(["Nombre: Maria Garcia", "Nombre del padre: Jose Garcia"].join("\n"));
    expect(fields.fullName).toBe("Maria Garcia");
  });

  it("ignores a date that is not labelled", () => {
    expect(extractLabelledFields("She was born in the spring of 1988 in Guadalajara.")).toEqual({});
  });
});

describe("extractBlankFields", () => {
  it("finds required-looking fields left empty", () => {
    expect(extractBlankFields(["Receipt Number: __________", "Priority Date: ", "Name: Maria"].join("\n"))).toEqual([
      "Receipt Number",
      "Priority Date",
    ]);
  });

  it("does not treat an empty notes line as a missing required field", () => {
    expect(extractBlankFields("Notes:")).toEqual([]);
  });
});

describe("classifyDocumentText", () => {
  it("recognises documents by what is printed on them", () => {
    expect(classifyDocumentText("ACTA DE NACIMIENTO\nRegistro Civil")).toBe("birth_certificate");
    expect(classifyDocumentText("PASAPORTE / PASSPORT")).toBe("passport");
    expect(classifyDocumentText("FORM I-797C, NOTICE OF ACTION")).toBe("uscis_notice");
  });

  it("returns null rather than guessing", () => {
    expect(classifyDocumentText("A letter from my landlord about the rent")).toBeNull();
  });
});
