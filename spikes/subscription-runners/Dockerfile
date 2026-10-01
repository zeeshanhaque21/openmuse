FROM node:24-bookworm-slim

RUN npm install --global @anthropic-ai/claude-code@2.1.285 @openai/codex@0.159.2
RUN mkdir -p /home/node/.claude /home/node/.codex /workspace \
    && chown -R node:node /workspace /home/node/.claude /home/node/.codex

USER node
WORKDIR /workspace

# Compatibility/authentication spike only. No Mac credentials enter the build context.
CMD ["node", "--version"]
