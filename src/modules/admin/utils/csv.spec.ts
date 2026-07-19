import { createCsv, escapeCsvValue, neutralizeCsvFormula } from "./csv";

describe("admin CSV utilities", () => {
  it.each(["=SUM(A1:A2)", "+cmd", "-1+2", "@IMPORTDATA(x)"])(
    "neutralizes spreadsheet formula input %s",
    (value) => expect(neutralizeCsvFormula(value)).toBe(`'${value}`),
  );

  it("escapes quotes, commas, line breaks, and Unicode", () => {
    expect(escapeCsvValue('Maurice, "M"\nLagos')).toBe('"Maurice, ""M""\nLagos"');
    expect(escapeCsvValue("Adé")).toBe('"Adé"');
  });

  it("emits a UTF-8 BOM and CRLF-delimited CSV", () => {
    expect(createCsv(["Name"], [["Ada"]])).toBe('\uFEFF"Name"\r\n"Ada"\r\n');
  });
});
