This directory is a placeholder — CDK's local asset bundling (see `SharpLayer` in `lib/media-app-stack.ts`) generates the actual layer contents at synth/deploy time by running:

```
npm install --os=linux --cpu=x64 sharp@<pinned version>
```

into a `nodejs/node_modules/` layout, using npm's cross-platform install flags to fetch Sharp's prebuilt Linux x64 binary — no Docker required. Nothing in this directory is committed except this note.
