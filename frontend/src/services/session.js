export function readStoredSession(storage = sessionStorage) {
  const token = storage.getItem("trustmesh_token");
  const serializedUser = storage.getItem("trustmesh_user");
  if (!token || !serializedUser) {
    clearSession(storage);
    return null;
  }

  try {
    const user = JSON.parse(serializedUser);
    if (!user || typeof user !== "object" || !user.id) {
      clearSession(storage);
      return null;
    }
    return user;
  } catch {
    clearSession(storage);
    return null;
  }
}

export function saveSession(result, storage = sessionStorage) {
  if (!result?.token || !result?.user?.id) {
    throw new Error("The authentication response was incomplete.");
  }
  storage.setItem("trustmesh_token", result.token);
  storage.setItem("trustmesh_user", JSON.stringify(result.user));
  return result.user;
}

export function clearSession(storage = sessionStorage) {
  storage.removeItem("trustmesh_token");
  storage.removeItem("trustmesh_user");
}
