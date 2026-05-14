import { get_encoding } from "js-tiktoken";

const enc = get_encoding("cl100k_base");

export const countTokens = (text) => {
  return enc.encode(text).length;
};
