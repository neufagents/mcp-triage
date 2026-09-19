# mcp-triage — stdio MCP server (serve mode). Zero runtime dependencies.
# Build spec for the Glama directory (introspection) and generic container use.
# Keep the pinned package version in sync with each release.
FROM node:22-alpine

RUN npm install -g mcp-triage@0.2.0 --no-fund --no-audit \
    && npm cache clean --force

CMD ["mcp-triage", "serve"]
