import { spotifyRedirectUriProblem } from "./spotify-redirect-uri";

describe("spotifyRedirectUriProblem", () => {
  it("accepts a single valid https callback URL", () => {
    expect(spotifyRedirectUriProblem("https://api-staging.repitair.com/api/auth/spotify/callback")).toBeNull();
  });

  it("allows http only for localhost", () => {
    expect(spotifyRedirectUriProblem("http://localhost:4000/api/auth/spotify/callback")).toBeNull();
    expect(spotifyRedirectUriProblem("http://api-staging.repitair.com/api/auth/spotify/callback")).toMatch(/https/);
  });

  it("rejects a comma-separated list (the reported misconfiguration)", () => {
    const problem = spotifyRedirectUriProblem(
      "https://a.up.railway.app/api/auth/spotify/callback,https://api-staging.repitair.com/api/auth/spotify/callback",
    );
    expect(problem).toMatch(/single URL/);
    expect(problem).toMatch(/dashboard/);
  });

  it("rejects missing/empty values", () => {
    expect(spotifyRedirectUriProblem(undefined)).toMatch(/not set/);
    expect(spotifyRedirectUriProblem("")).toMatch(/not set/);
    expect(spotifyRedirectUriProblem("   ")).toMatch(/not set/);
  });

  it("rejects an unparseable URL", () => {
    expect(spotifyRedirectUriProblem("not a url")).toMatch(/not a valid URL/);
  });

  it("rejects a wrong path", () => {
    expect(spotifyRedirectUriProblem("https://api-staging.repitair.com/auth/spotify/callback")).toMatch(/path must be/);
  });

  it("rejects a query string or fragment", () => {
    expect(spotifyRedirectUriProblem("https://api-staging.repitair.com/api/auth/spotify/callback?x=1")).toMatch(/query string or fragment/);
    expect(spotifyRedirectUriProblem("https://api-staging.repitair.com/api/auth/spotify/callback#x")).toMatch(/query string or fragment/);
  });

  it("tolerates surrounding whitespace", () => {
    expect(spotifyRedirectUriProblem("  https://api-staging.repitair.com/api/auth/spotify/callback  ")).toBeNull();
  });
});
