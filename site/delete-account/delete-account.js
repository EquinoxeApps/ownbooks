// Account deletion without the app (Google Play requirement; spec §4.1). Signs in with the same
// methods as the app, then calls the delete-account Edge Function with the session token.
(function () {
  const { supabaseUrl, supabaseKey } = window.OWNBOOKS_CONFIG;
  const client = window.supabase.createClient(supabaseUrl, supabaseKey, {
    auth: { flowType: 'pkce', detectSessionInUrl: true, persistSession: true, storage: window.sessionStorage },
  });

  const $ = (id) => document.getElementById(id);
  const PROVIDERS = [
    { id: 'google', label: 'Continue with Google' },
    { id: 'apple', label: 'Continue with Apple' },
    { id: 'facebook', label: 'Continue with Facebook' },
  ];

  function show(section) {
    for (const id of ['signed-out', 'signed-in', 'done']) $(id).hidden = id !== section;
  }

  // Only offer the providers that are switched on for the project.
  async function renderProviders() {
    let external = {};
    try {
      const res = await fetch(`${supabaseUrl}/auth/v1/settings`, { headers: { apikey: supabaseKey } });
      external = (await res.json()).external || {};
    } catch {
      // Email and password still work without the list.
    }
    for (const provider of PROVIDERS.filter((p) => external[p.id])) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'secondary';
      button.textContent = provider.label;
      button.addEventListener('click', async () => {
        $('sign-in-error').textContent = '';
        const { error } = await client.auth.signInWithOAuth({
          provider: provider.id,
          options: { redirectTo: window.location.origin + window.location.pathname },
        });
        if (error) $('sign-in-error').textContent = error.message;
      });
      $('providers').appendChild(button);
    }
  }

  function renderSession(session) {
    if (!session) {
      show('signed-out');
      return;
    }
    $('account-email').textContent = session.user.email || 'your account';
    $('confirm').value = '';
    $('delete').disabled = true;
    show('signed-in');
  }

  $('password-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    $('sign-in-error').textContent = '';
    const { error } = await client.auth.signInWithPassword({
      email: $('email').value.trim(),
      password: $('password').value,
    });
    if (error) {
      $('sign-in-error').textContent =
        error.code === 'invalid_credentials' ? 'Wrong email or password.' : error.message;
    }
  });

  $('confirm').addEventListener('input', () => {
    $('delete').disabled = $('confirm').value.trim() !== 'DELETE';
  });

  $('delete').addEventListener('click', async () => {
    $('delete').disabled = true;
    $('delete-error').textContent = '';
    const { error } = await client.functions.invoke('delete-account', { method: 'POST' });
    if (error) {
      $('delete-error').textContent = 'Your account couldn’t be deleted. Please try again, or email us.';
      $('delete').disabled = false;
      return;
    }
    // The user no longer exists; drop the local session without calling the server.
    deleted = true;
    await client.auth.signOut({ scope: 'local' });
    show('done');
  });

  $('sign-out').addEventListener('click', () => client.auth.signOut({ scope: 'local' }));

  let deleted = false;
  client.auth.onAuthStateChange((_event, session) => {
    if (!deleted) renderSession(session);
  });

  renderProviders();
  client.auth.getSession().then(({ data }) => renderSession(data.session));
})();
