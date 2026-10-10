import { describe, expect, it } from "vitest";
import { isValidIsbn, matchCategory, normalizeIsbn } from "@/lib/isbn-lookup";

describe("isbn helpers", () => {
  it("normalizes and validates", () => {
    expect(normalizeIsbn("978-0-14-044913-6")).toBe("9780140449136");
    expect(isValidIsbn("978-0-14-044913-6")).toBe(true);
    expect(isValidIsbn("0-306-40615-2")).toBe(true);
    expect(isValidIsbn("9780140449137")).toBe(false);
  });
  it("matches categories by subject", () => {
    expect(matchCategory([{ id: 1, name: "Fiction" }, { id: 2, name: "Science" }], ["Science fiction"])).toBe(1);
    expect(matchCategory([{ id: 2, name: "History" }], ["Poetry"])).toBeNull();
  });
});
