export async function getState() {
  const res = await fetch("/api/state");
  return res.json();
}

export async function createRoom(wager:number, creator:string) {
  const res = await fetch("/api/state", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      type: "room",
      wager,
      creator
    })
  });

  return res.json();
}
