# pi-bedrock-mantle

A [pi](https://pi.dev) provider for the OpenAI GPT models on
[Amazon Bedrock Mantle](https://docs.aws.amazon.com/bedrock/latest/userguide/bedrock-mantle.html),
with Mantle's server-side [web search](https://docs.aws.amazon.com/bedrock/latest/userguide/web-search.html).

- Signs requests with AWS SigV4 from the standard AWS credential chain. No Bedrock API key needed.
- Adds Mantle server tools (web search by default) to every request, and keeps the model's searches
  across turns.
- Routes each model to a Region that serves it, configurable per model.

Pi's built-in `amazon-bedrock` provider uses Converse on `bedrock-runtime`, where server-side tools
are unavailable, and does not serve the Mantle-only GPT models.

## Install

```sh
pi install git:github.com/tonyxwz/pi-bedrock-mantle
```

Then:

```sh
pi --list-models bedrock-mantle
pi --model bedrock-mantle/openai.gpt-5.6-terra
```

Requirements:

- AWS credentials pi can find: environment keys, `AWS_PROFILE`, SSO, process credentials, or a role.
- IAM permissions: `bedrock-mantle:CreateInference`, and for web search
  `bedrock-websearch:InvokeSearch` and `bedrock-websearch:InvokeFetch`.
- Access to the OpenAI models in the Bedrock console.

## Configuration

Settings live under `extensionSettings["pi-bedrock-mantle"]` in `~/.pi/agent/settings.json`. All
fields are optional.

```json
{
  "extensionSettings": {
    "pi-bedrock-mantle": {
      "region": "us-east-2",
      "regions": ["us-east-1"],
      "models": {
        "openai.gpt-6.2-astra": { "region": "us-east-1" },
        "openai.gpt-6.2-sol": { "region": "us-east-1" }
      },
      "serverTools": [{ "type": "web_search", "external_web_access": false }]
    }
  }
}
```

| Setting | Meaning | Default |
|---|---|---|
| `region` | Home Region: preferred for every model, and the provider's base URL | `BEDROCK_MANTLE_REGION`, `AWS_REGION`, `AWS_DEFAULT_REGION`, then `us-east-1` |
| `regions` | More Regions to look for models in, after `region`, in order of preference | none |
| `models.<id>.region` | Pin a model to a Region. The model is offered even when the Region's model list omits it | none |
| `serverTools` | Responses server tools added unchanged to every request. `[]` turns them off | web search, see below |

Settings are read when the extension loads (pi start or `/reload`). Project settings
(`.pi/settings.json`) are not read: pi does not let extensions read settings while loading, and the
project may not be trusted yet.

### Regions

Each model goes to its pinned Region, else to the first of `region`, then `regions`, whose
`GET /v1/models` list includes it. The lists are read at startup, all Regions at once, with a 3 s
timeout each. Models that no list includes are hidden. If a Region's list cannot be read, that
Region counts as serving every model, so a failed read hides nothing. Models outside the home Region
show it in their name, e.g. "GPT-6 Luna (us-east-1)".

Requests, web searches and prompt caches stay in the model's Region. Adding Regions to `regions` or
pinning a model to another Region sends that model's prompts there.

Pinning also covers models Mantle serves but does not list. At the time of writing, us-east-1 serves
`openai.gpt-6.2-astra` and `openai.gpt-6.2-sol` but leaves them out of `/v1/models`. Only models in
pi's `amazon-bedrock` catalog can be used, since the catalog supplies prices and limits.

### Server tools

The default is `{ "type": "web_search", "external_web_access": false }`, the same as Codex sends:
search and fetch stay inside AWS and need no `bedrock-websearch:ExternalWebAccess` permission. Any
Responses server tool Mantle accepts works, for example `"search_context_size": "high"` on web
search, or a Lambda or AgentCore Gateway connector:

```json
{ "type": "mcp", "server_label": "tools", "connector_id": "arn:aws:lambda:...", "require_approval": "never" }
```

## How it works

- Models: the GPT models from GPT-5.4 on in pi's `amazon-bedrock` catalog, with the catalog's prices
  and limits. `gpt-oss` models have no web search and are left out.
- Requests go through pi's built-in OpenAI Responses implementation to
  `https://bedrock-mantle.<region>.api.aws/openai/v1`, signed for the `bedrock-mantle` service.
- Searches across turns: pi drops `web_search_call` output items, so the model would forget what it
  searched. The extension records them next to the reasoning or message item they followed, saves
  them in the session as `bedrock-mantle-web-search` entries, and puts them back in place in later
  requests. Earlier request prefixes stay unchanged, so prompt caching keeps working.
- Display: the working line shows the current search, and after each answer a transcript line lists
  the queries and cited sources. These lines are not sent to the model.

## Limits

- GPT models only. Mantle's Anthropic Messages API rejects Anthropic's web search tool, and pi's
  built-in `amazon-bedrock` provider already serves Claude through Converse.
- Web search fees are not included in pi's cost display.
- `url_citation` annotations are not replayed. Answers usually carry the links inline.
- A search whose neighbours in the response were all function calls is not replayed, because pi
  strips function-call item ids for providers other than OpenAI's.

## Development

```sh
npm install
npm run check
npm test
pi -e .
```

## License

MIT
