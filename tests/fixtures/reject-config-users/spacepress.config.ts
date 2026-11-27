import { defineConfig, extend } from "spacepress";
const members = extend("users");
export default defineConfig({ users: { members } });
