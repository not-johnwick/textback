// business/*.md files are bundled as plain strings (see [[rules]] in wrangler.toml).
declare module "*.md" {
  const text: string;
  export default text;
}
