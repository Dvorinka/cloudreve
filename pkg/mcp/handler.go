package mcp

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"

	"github.com/cloudreve/Cloudreve/v4/application/constants"
	"github.com/cloudreve/Cloudreve/v4/application/dependency"
	"github.com/cloudreve/Cloudreve/v4/inventory"
	"github.com/cloudreve/Cloudreve/v4/pkg/auth"
	"github.com/gin-gonic/gin"
	mcpsdk "github.com/modelcontextprotocol/go-sdk/mcp"
)

// Endpoint is the streamable HTTP MCP endpoint. Clients authenticate with
// the same access token as the REST API: Authorization: Bearer <token>,
// issued by POST /api/v4/session/token.
const Endpoint = constants.APIPrefix + "/mcp"

type principalKey struct{}

// Authenticator turns an HTTP request into the user the tools will run as.
type Authenticator interface {
	Authenticate(r *http.Request) (Principal, error)
}

type tokenAuthenticator struct {
	dep dependency.Dep
}

func (a tokenAuthenticator) Authenticate(r *http.Request) (Principal, error) {
	ginCtx, _ := gin.CreateTestContext(httptest.NewRecorder())
	ginCtx.Request = r

	if _, err := a.dep.TokenAuth().VerifyAndRetrieveUser(ginCtx); err != nil {
		return Principal{}, err
	}
	ctx := ginCtx.Request.Context()
	uid := inventory.UserIDFromContext(ctx)
	if uid == 0 {
		return Principal{}, errUnauthorized
	}
	user, err := a.dep.UserClient().GetLoginUserByID(ctx, uid)
	if err != nil || user == nil || inventory.IsAnonymousUser(user) {
		return Principal{}, errUnauthorized
	}
	scoped, scopes := auth.GetScopesFromContext(ctx)
	return Principal{User: user, Scopes: scopes, Scoped: scoped}, nil
}

var errUnauthorized = errors.New("unauthorized")

// Mount registers the MCP endpoint on the master router. It is intentionally
// outside the cookie session group: agents present a bearer access token.
func Mount(r gin.IRoutes, dep dependency.Dep) {
	r.Any(Endpoint, gin.WrapH(NewHandler(tokenAuthenticator{dep: dep}, liveStore{dep: dep})))
}

// NewHandler authenticates every request, then serves a stateless MCP session
// bound to that user. Stateless mode needs no session affinity between
// Cloudreve processes.
func NewHandler(authn Authenticator, store Store) http.Handler {
	h := &handler{
		auth:  authn,
		store: store,
		cache: mcpsdk.NewSchemaCache(),
	}
	inner := mcpsdk.NewStreamableHTTPHandler(h.server, &mcpsdk.StreamableHTTPOptions{
		Stateless:    true,
		JSONResponse: true,
	})
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		principal, err := h.auth.Authenticate(r)
		if err != nil {
			w.Header().Set("WWW-Authenticate", `Bearer realm="cloudreve"`)
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}
		ctx := context.WithValue(r.Context(), principalKey{}, principal)
		inner.ServeHTTP(w, r.WithContext(ctx))
	})
}

type handler struct {
	auth  Authenticator
	store Store
	cache *mcpsdk.SchemaCache
}

func (h *handler) server(r *http.Request) *mcpsdk.Server {
	principal, _ := r.Context().Value(principalKey{}).(Principal)
	server := mcpsdk.NewServer(&mcpsdk.Implementation{
		Name:        "cloudreve",
		Title:       "Cloudreve",
		Version:     constants.BackendVersion,
		Description: "Files, shares, and storage for the authenticated Cloudreve user.",
	}, &mcpsdk.ServerOptions{
		Instructions: instructions,
		SchemaCache:  h.cache,
		Capabilities: &mcpsdk.ServerCapabilities{},
	})
	registerTools(server, h.store, principal)
	return server
}
