import { describe, expect, it } from "bun:test";
import { render, screen } from "@testing-library/react";
import { UserAvatar } from "./user-avatar";

describe("UserAvatar", () => {
  it("renders initials from first + last name", () => {
    render(<UserAvatar name="Ada Lovelace" email="ada@example.com" imageUrl={null} />);
    expect(screen.getByLabelText("Ada Lovelace")).toHaveTextContent("AL");
  });

  it("renders initial from single name", () => {
    render(<UserAvatar name="Ada" email="ada@example.com" imageUrl={null} />);
    expect(screen.getByLabelText("Ada")).toHaveTextContent("A");
  });

  it("falls back to email initial when name is empty", () => {
    render(<UserAvatar name={null} email="ada@example.com" imageUrl={null} />);
    expect(screen.getByLabelText("ada@example.com")).toHaveTextContent("A");
  });

  it("falls back to 'U' when name and email are missing", () => {
    render(<UserAvatar name={null} email={null} imageUrl={null} />);
    expect(screen.getByLabelText("User")).toHaveTextContent("U");
  });
});
