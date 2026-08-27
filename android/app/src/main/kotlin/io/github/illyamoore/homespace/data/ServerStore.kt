package io.github.illyamoore.homespace.data

import android.content.Context
import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.map
import kotlinx.serialization.Serializable
import kotlinx.serialization.builtins.ListSerializer

@Serializable
data class SavedServer(
    val id: String,
    val name: String,
    val baseUrl: String,
    val token: String,
) {
    fun toRef() = ServerRef(id = id, name = name, baseUrl = baseUrl, token = token)
}

enum class ThemeChoice { SYSTEM, DARK, LIGHT }

private val Context.dataStore: DataStore<Preferences> by preferencesDataStore(name = "homespace")

/**
 * Remembers which NAS boxes this device knows and which was last used.
 *
 * Tokens live here in plain text inside app-private storage. That is protected
 * by the platform sandbox and by file-based encryption on any device with a
 * lock screen, and the manifest excludes it from cloud backup and device
 * transfer — see docs/security.md for what that does and does not cover.
 */
class ServerStore(private val context: Context) {

    private companion object {
        val SERVERS = stringPreferencesKey("servers")
        val ACTIVE = stringPreferencesKey("active_server")
        val THEME = stringPreferencesKey("theme")
        const val MAX_SERVERS = 8
    }

    private val json = HomeSpaceClient.json

    val servers: Flow<List<SavedServer>> = context.dataStore.data.map { prefs ->
        decode(prefs[SERVERS])
    }

    val activeServerId: Flow<String?> = context.dataStore.data.map { it[ACTIVE] }

    val theme: Flow<ThemeChoice> = context.dataStore.data.map { prefs ->
        runCatching { ThemeChoice.valueOf(prefs[THEME] ?: ThemeChoice.SYSTEM.name) }
            .getOrDefault(ThemeChoice.SYSTEM)
    }

    private fun decode(raw: String?): List<SavedServer> {
        if (raw.isNullOrBlank()) return emptyList()
        // A store written by an older build, or corrupted, must not brick the
        // app on launch — fall back to "no saved servers" and let the operator
        // pair again.
        return runCatching {
            json.decodeFromString(ListSerializer(SavedServer.serializer()), raw)
        }.getOrDefault(emptyList())
    }

    /** Most recently used first, capped, deduplicated by id. */
    suspend fun save(server: SavedServer) {
        context.dataStore.edit { prefs ->
            val existing = decode(prefs[SERVERS]).filterNot { it.id == server.id }
            val updated = (listOf(server) + existing).take(MAX_SERVERS)
            prefs[SERVERS] = json.encodeToString(ListSerializer(SavedServer.serializer()), updated)
            prefs[ACTIVE] = server.id
        }
    }

    suspend fun forget(id: String) {
        context.dataStore.edit { prefs ->
            val updated = decode(prefs[SERVERS]).filterNot { it.id == id }
            prefs[SERVERS] = json.encodeToString(ListSerializer(SavedServer.serializer()), updated)
            if (prefs[ACTIVE] == id) prefs.remove(ACTIVE)
        }
    }

    suspend fun setActive(id: String?) {
        context.dataStore.edit { prefs ->
            if (id == null) prefs.remove(ACTIVE) else prefs[ACTIVE] = id
        }
    }

    suspend fun setTheme(choice: ThemeChoice) {
        context.dataStore.edit { it[THEME] = choice.name }
    }

    /** The server to reconnect to on launch, if its record still exists. */
    suspend fun lastUsed(): SavedServer? {
        val id = activeServerId.first() ?: return null
        return servers.first().firstOrNull { it.id == id }
    }

    /** Identity is the normalised address, so re-pairing the same NAS with a
     *  rotated token updates the record rather than adding a duplicate. */
    fun idFor(baseUrl: String): String = baseUrl.trimEnd('/').lowercase()
}
