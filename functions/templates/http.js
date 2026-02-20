(() => {
  const name = body?.name ?? "world";

  console.log("template invoked", { name });

  return {
    ok: true,
    message: "Hello " + name,
    timestamp: new Date().toISOString(),
  };
})();
