export function addWatchlistItem(watchlist: string[], symbol: string) {
  const normalized = symbol.trim().toUpperCase();
  if (!normalized || watchlist.includes(normalized)) return watchlist;
  return [...watchlist, normalized];
}

export function removeWatchlistItem(watchlist: string[], favorites: string[], symbol: string) {
  return {
    watchlist: watchlist.filter((item) => item !== symbol),
    favorites: favorites.filter((item) => item !== symbol),
  };
}

export function toggleFavoriteItem(favorites: string[], symbol: string) {
  return favorites.includes(symbol) ? favorites.filter((item) => item !== symbol) : [...favorites, symbol];
}
