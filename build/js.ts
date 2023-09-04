import { build } from "esbuild";
import esbuildConfig from "./esbuild-config";

build(esbuildConfig(true));
