"use client";

import { useEffect, useState } from "react";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!
);

type Restaurant = {
  id: string;
  name: string;
};

export default function DashboardPage() {
  const [email, setEmail] = useState("");
  const [restaurants, setRestaurants] = useState<Restaurant[]>([]);
  const [message, setMessage] = useState("Loading...");
  const [loggedIn, setLoggedIn] = useState(false);

  useEffect(() => {
    async function loadDashboard() {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) {
        setMessage("Please log in first.");
        return;
      }

      setEmail(user.email ?? "");

      const { data, error } = await supabase
        .from("restaurants")
        .select("id, name")
        .order("name");

      if (error) {
        setMessage(error.message);
        return;
      }

      setRestaurants(data ?? []);
      setLoggedIn(true);
      setMessage("");
    }

    loadDashboard();
  }, []);

  async function handleLogout() {
    await supabase.auth.signOut({ scope: "local" });
    window.location.href = "/login";
  }

  if (!loggedIn) {
    return (
      <main style={{ padding: "40px", fontFamily: "Arial, sans-serif" }}>
        <p>{message}</p>
        <a href="/login">Go to login</a>
      </main>
    );
  }

  return (
    <main
      style={{
        maxWidth: "900px",
        margin: "0 auto",
        padding: "40px 24px",
        fontFamily: "Arial, sans-serif",
      }}
    >
      <header
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: "16px",
        }}
      >
        <div>
          <h1>TableKeeper Dashboard</h1>
          <p>Signed in as: {email}</p>
        </div>

        <button onClick={handleLogout}>Log out</button>
      </header>

      <section>
        <h2>Restaurants</h2>

        {restaurants.length === 0 ? (
          <p>No restaurants found.</p>
        ) : (
          <div style={{ display: "grid", gap: "12px" }}>
            {restaurants.map((restaurant) => (
              <article
                key={restaurant.id}
                style={{
                  border: "1px solid #ddd",
                  borderRadius: "8px",
                  padding: "16px",
                }}
              >
                <h3>{restaurant.name}</h3>
                <small>{restaurant.id}</small>
              </article>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
