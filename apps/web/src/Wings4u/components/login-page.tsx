"use client";

import { useRouter } from "next/navigation";
import { styles } from "../styles";

export function LoginPage() {
  const router = useRouter();

  return (
    <div style={{ padding: "2rem 2.5rem 4rem", display: "flex", justifyContent: "center" }}>
      <div style={{ ...styles.modal, maxWidth: 520 }}>
        <h2 style={styles.modalTitle}>LOGIN</h2>
        <input placeholder="Email" style={styles.input} />
        <input placeholder="Password" type="password" style={styles.input} />
        <button
          style={{ ...styles.btnPrimary, width: "100%", marginTop: 8 }}
          onMouseEnter={(e) => (e.currentTarget.style.transform = "translateY(-2px)")}
          onMouseLeave={(e) => (e.currentTarget.style.transform = "translateY(0)")}
        >
          SIGN IN →
        </button>
        <p style={{ textAlign: "center", color: "#aaa", marginTop: 12, fontSize: 13 }}>
          No account?{" "}
          <span style={{ color: "#f5a623", cursor: "pointer" }}>Sign up free</span>
        </p>
        <button style={styles.closeBtn} onClick={() => router.push("/")}>
          ✕ CLOSE
        </button>
      </div>
    </div>
  );
}