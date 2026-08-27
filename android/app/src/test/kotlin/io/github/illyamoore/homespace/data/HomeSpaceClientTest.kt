package io.github.illyamoore.homespace.data

import kotlinx.coroutines.test.runTest
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Before
import org.junit.Test

class HomeSpaceClientTest {

    private lateinit var server: MockWebServer

    @Before
    fun setUp() {
        server = MockWebServer()
        server.start()
    }

    @After
    fun tearDown() {
        server.shutdown()
    }

    private fun client(token: String = "test-token") = HomeSpaceClient(
        ServerRef(id = "test", name = "Test", baseUrl = server.url("/").toString().trimEnd('/'), token = token),
    )

    private fun json(body: String) = MockResponse()
        .setHeader("content-type", "application/json")
        .setBody(body)

    // ------------------------------------------------------- url handling

    @Test
    fun `normalizeBaseUrl adds a scheme when the user omits one`() {
        assertEquals("http://nas.local:7333", HomeSpaceClient.normalizeBaseUrl("nas.local:7333"))
        assertEquals("http://nas.local", HomeSpaceClient.normalizeBaseUrl("  nas.local  "))
    }

    @Test
    fun `normalizeBaseUrl keeps an explicit scheme and trims a trailing slash`() {
        assertEquals("https://nas.example.com", HomeSpaceClient.normalizeBaseUrl("https://nas.example.com/"))
        assertEquals("http://10.0.0.5:7333", HomeSpaceClient.normalizeBaseUrl("http://10.0.0.5:7333//"))
    }

    @Test
    fun `normalizeBaseUrl rejects what cannot be a URL`() {
        assertNull(HomeSpaceClient.normalizeBaseUrl(""))
        assertNull(HomeSpaceClient.normalizeBaseUrl("   "))
        // A bare scheme has no host; it used to come back as "http://http:".
        assertNull(HomeSpaceClient.normalizeBaseUrl("http://"))
        assertNull(HomeSpaceClient.normalizeBaseUrl("https://"))
        assertNull(HomeSpaceClient.normalizeBaseUrl("/just/a/path"))
    }

    @Test
    fun `normalizeBaseUrl drops the default port but keeps an explicit one`() {
        assertEquals("http://nas.local", HomeSpaceClient.normalizeBaseUrl("http://nas.local:80"))
        assertEquals("https://nas.example.com", HomeSpaceClient.normalizeBaseUrl("https://nas.example.com:443"))
        assertEquals("http://nas.local:7333", HomeSpaceClient.normalizeBaseUrl("nas.local:7333"))
    }

    @Test
    fun `normalizeBaseUrl keeps a reverse-proxy subpath`() {
        assertEquals(
            "https://home.example.com/homespace",
            HomeSpaceClient.normalizeBaseUrl("https://home.example.com/homespace/"),
        )
    }

    @Test
    fun `normalizeBaseUrl discards a pasted query string`() {
        assertEquals(
            "http://nas.local:7333",
            HomeSpaceClient.normalizeBaseUrl("http://nas.local:7333/?token=leaked"),
        )
    }

    @Test
    fun `a subpath base still builds correct api urls`() = runTest {
        server.enqueue(json("""{"sessions":[]}"""))
        val ref = ServerRef(
            id = "p",
            name = "proxied",
            baseUrl = server.url("/homespace").toString().trimEnd('/'),
            token = "t",
        )
        HomeSpaceClient(ref).sessions()
        assertEquals("/homespace/api/sessions", server.takeRequest().path)
    }

    @Test
    fun `file paths keep their slashes but each segment is encoded`() = runTest {
        server.enqueue(json("""{"rootId":"media","path":"a/b","entries":[]}"""))
        client().list("media", "movies 2024/a b.mkv")

        val request = server.takeRequest()
        // Slashes survive as path separators; the spaces are encoded.
        assertEquals("/api/files/media/list/movies%202024/a%20b.mkv", request.path)
    }

    @Test
    fun `raw url carries the token so media players can fetch it`() {
        val url = client("secret").rawUrl("media", "clips/a.mp4", download = true)
        assertTrue(url.contains("/api/files/media/raw/clips/a.mp4"))
        assertTrue(url.contains("token=secret"))
        assertTrue(url.contains("download=1"))
    }

    @Test
    fun `raw url omits the download flag unless asked`() {
        assertTrue(!client().rawUrl("media", "a.mp4").contains("download"))
    }

    // ------------------------------------------------------------- auth

    @Test
    fun `every request carries the bearer token`() = runTest {
        server.enqueue(json("""{"sessions":[]}"""))
        client("abc123").sessions()
        assertEquals("Bearer abc123", server.takeRequest().getHeader("Authorization"))
    }

    // -------------------------------------------------------- decoding

    @Test
    fun `system snapshot decodes`() = runTest {
        server.enqueue(
            json(
                """
                {"name":"NAS","hostname":"nas","platform":"linux","arch":"x64","uptimeSeconds":100,
                 "loadAverage":[0.5,0.4,0.3],"cpu":{"model":"Celeron","cores":4},
                 "memory":{"totalBytes":100,"freeBytes":40,"usedPct":60},
                 "claude":{"bin":"claude","available":true,"version":"2.1.0","maxConcurrentSessions":4},
                 "roots":[{"id":"code","label":"Code","path":"/v1/code","workspace":true,"readOnly":false,
                           "available":true,"disk":{"totalBytes":10,"freeBytes":5}}]}
                """.trimIndent(),
            ),
        )
        val snapshot = client().system()
        assertEquals("NAS", snapshot.name)
        assertEquals(4, snapshot.cpu.cores)
        assertTrue(snapshot.claude.available)
        assertEquals(1, snapshot.roots.size)
        assertTrue(snapshot.roots[0].workspace)
    }

    @Test
    fun `unknown fields from a newer daemon are ignored`() = runTest {
        server.enqueue(json("""{"name":"NAS","somethingNew":{"a":1},"roots":[]}"""))
        assertEquals("NAS", client().system().name)
    }

    @Test
    fun `missing optional fields fall back to defaults instead of throwing`() = runTest {
        server.enqueue(json("""{"sessions":[{"id":"s1","title":"t"}]}"""))
        val session = client().sessions().sessions.single()
        assertEquals("s1", session.id)
        assertEquals("idle", session.status)
        assertEquals(0, session.turns)
        assertEquals(0L, session.usage.outputTokens)
    }

    @Test
    fun `session live and busy flags follow status`() {
        assertTrue(Session(status = "working").isLive)
        assertTrue(Session(status = "working").isBusy)
        assertTrue(Session(status = "idle").isLive)
        assertTrue(!Session(status = "exited").isLive)
        assertTrue(!Session(status = "error").isLive)
    }

    // --------------------------------------------------------- failures

    @Test
    fun `an error body becomes the exception message`() = runTest {
        server.enqueue(MockResponse().setResponseCode(403).setBody("""{"error":"path escapes its root"}"""))
        try {
            client().list("media", "../etc")
            fail("expected an ApiException")
        } catch (e: ApiException) {
            assertEquals(403, e.status)
            assertEquals("path escapes its root", e.message)
        }
    }

    @Test
    fun `a 401 is flagged so the caller can re-pair`() = runTest {
        server.enqueue(MockResponse().setResponseCode(401).setBody("""{"error":"invalid token"}"""))
        try {
            client().system()
            fail("expected an ApiException")
        } catch (e: ApiException) {
            assertTrue(e.isUnauthorized)
        }
    }

    @Test
    fun `a non-JSON error body still produces a usable message`() = runTest {
        server.enqueue(MockResponse().setResponseCode(502).setBody("<html>bad gateway</html>"))
        try {
            client().system()
            fail("expected an ApiException")
        } catch (e: ApiException) {
            assertEquals(502, e.status)
            assertTrue(e.message!!.isNotBlank())
        }
    }

    // ---------------------------------------------------------- writing

    @Test
    fun `starting a session posts the request body`() = runTest {
        server.enqueue(json("""{"id":"s1","title":"work"}"""))
        client().startSession(NewSessionRequest(rootId = "code", path = "proj", title = "work"))

        val request = server.takeRequest()
        assertEquals("POST", request.method)
        assertEquals("/api/sessions", request.path)
        val body = request.body.readUtf8()
        assertTrue(body.contains("\"rootId\":\"code\""))
        assertTrue(body.contains("\"path\":\"proj\""))
    }

    @Test
    fun `a partial agent update omits the fields that were not set`() = runTest {
        server.enqueue(json("""{"id":"a1","name":"Tidy"}"""))
        client().updateAgent("a1", AgentInput(description = "new purpose"))

        val request = server.takeRequest()
        assertEquals("PATCH", request.method)
        val body = request.body.readUtf8()
        assertTrue(body.contains("description"))
        // name was never set, so it must not be sent as null and blank the field.
        assertTrue(!body.contains("\"name\""))
    }

    @Test
    fun `deleting an agent uses DELETE and tolerates an empty body`() = runTest {
        server.enqueue(MockResponse().setResponseCode(204))
        client().deleteAgent("a1")

        val request = server.takeRequest()
        assertEquals("DELETE", request.method)
        assertEquals("/api/agents/a1", request.path)
    }

    @Test
    fun `events url carries the token because EventSource cannot set headers`() {
        val url = client("tok").eventsUrl("s1").toString()
        assertTrue(url.contains("token=tok"))
        assertTrue(url.contains("sessionId=s1"))
    }
}
