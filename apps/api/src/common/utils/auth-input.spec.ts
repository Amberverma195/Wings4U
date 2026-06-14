import {
  parseEmailInput,
  parseFullNameInput,
  parseLoginIdentifier,
  parseNanpPhoneInput,
  parseOtpCodeInput,
} from "./auth-input";

describe("auth-input", () => {
  describe("parseNanpPhoneInput", () => {
    it("normalizes a formatted 10-digit NANP number to E.164", () => {
      expect(parseNanpPhoneInput("(437) 966-0600")).toBe("+14379660600");
    });

    it("rejects too many digits", () => {
      expect(() => parseNanpPhoneInput("464848486486486464646766")).toThrow(
        "10 digit",
      );
    });

    it("rejects SQL injection payloads", () => {
      expect(() => parseNanpPhoneInput("1234567890'; DROP TABLE users;--")).toThrow(
        "Invalid",
      );
    });

    it("rejects letters in a phone-only value", () => {
      expect(() => parseNanpPhoneInput("123456789a")).toThrow("Invalid");
    });
  });

  describe("parseEmailInput", () => {
    it("normalizes email to lowercase", () => {
      expect(parseEmailInput("Jane@Example.COM")).toBe("jane@example.com");
    });

    it("rejects SQL injection in email", () => {
      expect(() => parseEmailInput("admin'--@example.com")).toThrow("Invalid");
    });

    it("rejects malformed email", () => {
      expect(() => parseEmailInput("not-an-email")).toThrow("valid email");
    });
  });

  describe("parseLoginIdentifier", () => {
    it("parses phone identifiers", () => {
      expect(parseLoginIdentifier("(437) 966-0600")).toEqual({
        kind: "phone",
        value: "+14379660600",
      });
    });

    it("parses email identifiers", () => {
      expect(parseLoginIdentifier("jane@example.com")).toEqual({
        kind: "email",
        value: "jane@example.com",
      });
    });
  });

  describe("parseFullNameInput", () => {
    it("accepts a normal name", () => {
      expect(parseFullNameInput("Jane Doe")).toBe("Jane Doe");
    });

    it("rejects injection in name", () => {
      expect(() => parseFullNameInput("Jane'; DROP TABLE users;--")).toThrow(
        "Invalid",
      );
    });
  });

  describe("parseOtpCodeInput", () => {
    it("accepts numeric OTP codes", () => {
      expect(parseOtpCodeInput("123456")).toBe("123456");
    });

    it("rejects non-numeric OTP codes", () => {
      expect(() => parseOtpCodeInput("12ab56")).toThrow("Invalid verification code");
    });
  });
});
