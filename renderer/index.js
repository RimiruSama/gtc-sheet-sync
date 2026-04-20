(() => {
  const TOKEN_STORAGE_KEY = "gtc.token";

  const tokenForm = document.getElementById("tokenForm");
  const tokenInput = document.getElementById("tokenInput");
  const tokenWarning = document.getElementById("tokenWarning");

  function getToken() {
    return window.localStorage.getItem(TOKEN_STORAGE_KEY) || "";
  }

  function setToken(token) {
    window.localStorage.setItem(TOKEN_STORAGE_KEY, token);
  }

  function goList() {
    window.location.href = "./list.html";
  }

  tokenForm.addEventListener("submit", (e) => {
    e.preventDefault();
    const token = String(tokenInput.value || "").trim();
    tokenWarning.hidden = true;

    if (!token) {
      tokenWarning.hidden = false;
      tokenInput.focus();
      return;
    }

    setToken(token);
    goList();
  });

  // Boot
  if (getToken()) {
    goList();
  } else {
    tokenInput.focus();
  }
})();
