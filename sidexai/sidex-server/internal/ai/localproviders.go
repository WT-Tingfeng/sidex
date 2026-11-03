package ai

import (
	"encoding/json"
	"os"
	"strings"
)

// Provider credentials supplied by the desktop app.
//
// When SideX runs the server itself (the normal case — no account, everything
// on-device), the app resolves the user's credentials and passes them down as
// environment variables rather than writing them to a config file:
//
//	SIDEX_PROVIDER_<PROVIDER>_KEY        e.g. SIDEX_PROVIDER_ANTHROPIC_KEY
//	SIDEX_PROVIDER_<PROVIDER>_BASE_URL   e.g. SIDEX_PROVIDER_OLLAMA_BASE_URL
//	SIDEX_PROVIDER_<PROVIDER>_AUTH       "api_key" (default) or "oauth"
//	SIDEX_PROVIDER_<PROVIDER>_AUTH_STYLE "bearer" (default), "x-api-key",
//	                                     "api-key" or "none"
//	SIDEX_PROVIDER_<PROVIDER>_PROTOCOL   "openai" (default) or "anthropic"
//	SIDEX_PROVIDER_<PROVIDER>_MODELS     JSON array of model ids, used as the
//	                                     /v1/models fallback
//
// See src-tauri/src/commands/providers.rs for the resolution order that
// decides what ends up here.
const (
	envProviderPrefix  = "SIDEX_PROVIDER_"
	envKeySuffix       = "_KEY"
	envBaseURLSuffix   = "_BASE_URL"
	envAuthModeSuffix  = "_AUTH"
	envAuthStyleSuffix = "_AUTH_STYLE"
	envProtocolSuffix  = "_PROTOCOL"
	envModelsSuffix    = "_MODELS"
	envAccountIDSuffix = "_ACCOUNT_ID"
)

func envProviderVar(provider, suffix string) string {
	// Custom provider ids are user-chosen slugs, so they may contain characters
	// ("my-api", "acme.local") that are not valid in a shell variable name. The
	// desktop app sanitises ids the same way before exporting them, so map every
	// non-alphanumeric rune to '_' on this side too.
	name := strings.Map(func(r rune) rune {
		switch {
		case r >= 'A' && r <= 'Z', r >= 'a' && r <= 'z', r >= '0' && r <= '9':
			return r
		default:
			return '_'
		}
	}, provider)
	return envProviderPrefix + strings.ToUpper(name) + suffix
}

// LocalProviderConfig builds a ProviderConfig for `provider` from the
// environment, or reports false when the app did not supply one.
//
// A provider with a base URL but no key is still valid: that is how a loopback
// server such as Ollama or LM Studio is configured, and a custom provider may
// declare AUTH_STYLE=none to talk to a keyless remote endpoint.
func LocalProviderConfig(provider string) (ProviderConfig, bool) {
	if provider == "" {
		return ProviderConfig{}, false
	}

	baseURL := strings.TrimSpace(os.Getenv(envProviderVar(provider, envBaseURLSuffix)))
	apiKey := strings.TrimSpace(os.Getenv(envProviderVar(provider, envKeySuffix)))
	authStyle := normalizeAuthStyle(os.Getenv(envProviderVar(provider, envAuthStyleSuffix)))

	if baseURL == "" {
		// Fall back to the built-in endpoint so a key alone is enough.
		baseURL = DirectProviders[provider]
	}
	if baseURL == "" {
		return ProviderConfig{}, false
	}
	if apiKey == "" && authStyle != AuthStyleNone && !isLoopback(baseURL) {
		// A remote provider without a key cannot be called. Keyless endpoints
		// are valid only when they are loopback (Ollama, LM Studio, …) or when
		// the provider explicitly declares AUTH_STYLE=none.
		return ProviderConfig{}, false
	}

	authMode := strings.TrimSpace(os.Getenv(envProviderVar(provider, envAuthModeSuffix)))
	if authMode == "" {
		authMode = AuthModeAPIKey
	}

	return ProviderConfig{
		Provider:  provider,
		APIKey:    apiKey,
		BaseURL:   strings.TrimRight(baseURL, "/"),
		AuthMode:  authMode,
		AuthStyle: authStyle,
		Protocol:  normalizeProtocol(os.Getenv(envProviderVar(provider, envProtocolSuffix))),
		Models:    parseDeclaredModels(os.Getenv(envProviderVar(provider, envModelsSuffix))),
		AccountID: strings.TrimSpace(os.Getenv(envProviderVar(provider, envAccountIDSuffix))),
		Enabled:   true,
	}, true
}

// isLoopback reports whether a base URL points at this machine, which is the
// only case where an empty API key is meaningful.
func isLoopback(baseURL string) bool {
	lowered := strings.ToLower(baseURL)
	for _, host := range []string{"//127.0.0.1", "//localhost", "//[::1]", "//0.0.0.0"} {
		if strings.Contains(lowered, host) {
			return true
		}
	}
	return false
}

// normalizeAuthStyle maps SIDEX_PROVIDER_<ID>_AUTH_STYLE to one of the known
// header styles. An unset value stays empty so built-in providers keep their
// historical header rules; an unrecognised value falls back to bearer, which
// is what OpenAI-compatible endpoints expect.
func normalizeAuthStyle(raw string) string {
	switch strings.ToLower(strings.TrimSpace(raw)) {
	case "":
		return ""
	case AuthStyleNone, "no_auth", "noauth", "keyless":
		return AuthStyleNone
	case AuthStyleXAPIKey, "x_api_key", "xapikey":
		return AuthStyleXAPIKey
	case AuthStyleAPIKey, "api_key", "apikey":
		return AuthStyleAPIKey
	default:
		return AuthStyleBearer
	}
}

// normalizeProtocol maps SIDEX_PROVIDER_<ID>_PROTOCOL to a known wire
// protocol. An unset value stays empty so built-in providers keep inferring it
// from their id; anything unrecognised is treated as OpenAI-compatible.
func normalizeProtocol(raw string) string {
	switch strings.ToLower(strings.TrimSpace(raw)) {
	case "":
		return ""
	case ProtocolAnthropic, "claude", "messages", "anthropic_messages":
		return ProtocolAnthropic
	case ProtocolOpenAI, "openai_compatible", "openai-compatible", "oai":
		return ProtocolOpenAI
	default:
		return ProtocolOpenAI
	}
}

// parseDeclaredModels decodes SIDEX_PROVIDER_<ID>_MODELS, a JSON array of model
// ids. A plain comma-separated list is accepted too: quoting is easy to mangle
// when the desktop app builds the environment, and rejecting the whole list
// would be worse than a lenient parse. Blank and duplicate entries are dropped.
func parseDeclaredModels(raw string) []string {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return nil
	}

	parsed := []string{}
	if err := json.Unmarshal([]byte(raw), &parsed); err != nil {
		parsed = strings.Split(raw, ",")
	}

	out := make([]string, 0, len(parsed))
	seen := make(map[string]struct{}, len(parsed))
	for _, model := range parsed {
		model = strings.TrimSpace(model)
		if model == "" {
			continue
		}
		if _, ok := seen[model]; ok {
			continue
		}
		seen[model] = struct{}{}
		out = append(out, model)
	}
	if len(out) == 0 {
		return nil
	}
	return out
}

// LocalProviderConfigured reports whether the app supplied credentials for the
// given provider, without building the full config.
func LocalProviderConfigured(provider string) bool {
	_, ok := LocalProviderConfig(provider)
	return ok
}
