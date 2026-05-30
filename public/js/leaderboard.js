// Shared leaderboard API for MiniGames
// Requires window.SUPABASE_URL and window.SUPABASE_ANON_KEY (from supabase-config.js)

const LeaderboardAPI = (() => {
  function _headers() {
    return {
      'Content-Type': 'application/json',
      'apikey': window.SUPABASE_ANON_KEY,
      'Authorization': 'Bearer ' + window.SUPABASE_ANON_KEY
    };
  }

  async function submitScore(gameId, playerName, score, metadata) {
    const r = await fetch(window.SUPABASE_URL + '/rest/v1/leaderboard_scores', {
      method: 'POST',
      headers: Object.assign(_headers(), { 'Prefer': 'return=minimal' }),
      body: JSON.stringify({
        game_id: gameId,
        player_name: (playerName || 'AAA').trim().toUpperCase().slice(0, 10),
        score: Math.floor(score),
        metadata: metadata || {}
      })
    });
    if (!r.ok) {
      const text = await r.text().catch(() => '');
      throw new Error('Submit failed (' + r.status + '): ' + text);
    }
  }

  // Fetch top scores for a game. Returns array of {player_name, score, metadata, created_at}
  async function fetchTop(gameId, limit) {
    const url = window.SUPABASE_URL + '/rest/v1/leaderboard_scores'
      + '?game_id=eq.' + encodeURIComponent(gameId)
      + '&order=score.desc'
      + '&limit=' + (limit || 10)
      + '&select=player_name,score,metadata,created_at';
    const r = await fetch(url, { headers: _headers() });
    if (!r.ok) throw new Error('Fetch failed (' + r.status + ')');
    return r.json();
  }

  return { submitScore, fetchTop };
})();
