# Changelog

## [0.1.0]

### Added

- `bedrock-mantle` provider for the OpenAI GPT models on Amazon Bedrock Mantle, signed with SigV4
  from the AWS credential chain.
- Server tools on every request, web search by default, configurable with `serverTools`.
- Web search calls kept across turns.
- Per-model Regions: `region`, `regions` and `models.<id>.region` settings.
