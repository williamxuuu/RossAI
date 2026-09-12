import { describe, expect, it } from "vitest";
import { caseCode, extractCaseCode } from "./casecode";

/**
 * The link between a phone-based case and an email nobody has seen before. If this
 * breaks, a client's documents silently open a second empty case.
 */
describe("caseCode", () => {
  it("is stable, short and derived from the case id", () => {
    expect(caseCode("903cdb3f-89e3-4e78-8eb7-2a208f35829f")).toBe("RA-903CDB");
    expect(caseCode("903cdb3f-89e3-4e78-8eb7-2a208f35829f")).toBe(caseCode("903cdb3f-89e3-4e78-8eb7-2a208f35829f"));
  });
});

describe("extractCaseCode", () => {
  it("finds the code however the client's mail client mangled the subject", () => {
    for (const subject of [
      "RA-903CDB",
      "Re: Mis documentos RA-903CDB",
      "FWD: ra-903cdb documents attached",
      "My documents (RA 903CDB)",
    ]) {
      expect(extractCaseCode(subject), subject).toBe("903cdb");
    }
  });

  it("looks in the body when the subject has been lost", () => {
    expect(extractCaseCode("Documents", "Hola, aqui estan. RA-903CDB")).toBe("903cdb");
  });

  it("returns null rather than guessing", () => {
    expect(extractCaseCode("Mis documentos", "Aqui estan mis papeles")).toBeNull();
    expect(extractCaseCode("RA-12345")).toBeNull(); // too short to be a code
    expect(extractCaseCode(null, undefined, "")).toBeNull();
  });
});
