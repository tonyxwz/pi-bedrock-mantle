// SigV4 signing for Bedrock Mantle: a fetch that replaces the SDK's placeholder API key with an
// AWS Signature V4 for the `bedrock-mantle` service, using the AWS default credential chain.

import { createHash, createHmac } from "node:crypto";
import { defaultProvider } from "@aws-sdk/credential-provider-node";
import { SignatureV4 } from "@smithy/signature-v4";

// Mantle rejects credentials scoped to any other service ("Credential should be scoped to
// correct service: 'bedrock-mantle'").
const SIGV4_SERVICE = "bedrock-mantle";

/** A fetch that signs every request for Bedrock Mantle in `region`. */
export function createMantleSigV4Fetch(region: string): typeof fetch {
	// The provider chain honors AWS_PROFILE, memoizes credentials and refreshes them before expiry.
	const signer = new SignatureV4({
		credentials: defaultProvider(),
		region,
		service: SIGV4_SERVICE,
		sha256: Sha256,
	});

	return async (input, init) => {
		const request = new Request(input, init);
		const url = new URL(request.url);
		const body = request.body ? await request.text() : undefined;
		const headers: Record<string, string> = { host: url.host };
		request.headers.forEach((value, name) => {
			// The OpenAI SDK always sends `Authorization: Bearer <apiKey>`; SigV4 owns this header.
			if (name !== "authorization") headers[name] = value;
		});
		const query: Record<string, string | string[]> = {};
		for (const [name, value] of url.searchParams) {
			const current = query[name];
			query[name] = current === undefined ? value : [...(Array.isArray(current) ? current : [current]), value];
		}
		const signed = await signer.sign({
			method: request.method,
			protocol: url.protocol,
			hostname: url.hostname,
			path: url.pathname,
			query,
			headers,
			body,
		});
		const signedHeaders = new Headers(signed.headers as Record<string, string>);
		// fetch sets Host itself and rejects an explicit one.
		signedHeaders.delete("host");
		return fetch(url, { method: request.method, headers: signedHeaders, body, signal: request.signal });
	};
}

/** SHA-256 and HMAC-SHA-256 from node:crypto, in the shape SignatureV4 expects. */
class Sha256 {
	private readonly hash;

	constructor(secret?: string | ArrayBuffer | ArrayBufferView) {
		this.hash = secret
			? createHmac("sha256", typeof secret === "string" ? secret : new Uint8Array(secret as ArrayBuffer))
			: createHash("sha256");
	}

	update(data: string | ArrayBufferView): void {
		this.hash.update(data as string);
	}

	async digest(): Promise<Uint8Array> {
		return new Uint8Array(this.hash.digest());
	}
}
