import Link from "next/link";
import type { ReactNode } from "react";
import styles from "./legal-page.module.css";

export type LegalSection = { id: string; title: string; content: ReactNode };

export function LegalPage({ title, summary, sections }: {
  title: string; summary: string; sections: LegalSection[];
}) {
  return (
    <main className={styles.page} id="legal-top" aria-labelledby="legal-title">
      <div className={styles.container}>
        <header className={styles.header}>
          <p className={styles.eyebrow}>Wings 4 U · London, Ontario</p>
          <h1 id="legal-title">{title}</h1>
          <p className={styles.summary}>{summary}</p>
          <p className={styles.updated}>Last updated <time dateTime="2026-10-23">October 23, 2026</time></p>
          <nav className={styles.related} aria-label="Legal documents">
            <Link href="/privacy" aria-current={title === "Privacy Policy" ? "page" : undefined}>Privacy Policy</Link>
            <Link href="/terms" aria-current={title === "Terms of Service" ? "page" : undefined}>Terms of Service</Link>
            <Link href="/account/delete">Delete your account</Link>
          </nav>
        </header>
        <div className={styles.layout}>
          <nav className={styles.contents} aria-label={`${title} contents`}>
            <h2>On this page</h2>
            <ol>{sections.map(section => <li key={section.id}><a href={`#${section.id}`}>{section.title}</a></li>)}</ol>
          </nav>
          <article className={styles.article} aria-labelledby="legal-title">
            {sections.map(section => (
              <section key={section.id} id={section.id} aria-labelledby={`${section.id}-title`} tabIndex={-1}>
                <h2 id={`${section.id}-title`}>{section.title}</h2>
                {section.content}
              </section>
            ))}
            <a href="#legal-top">Back to top</a>
          </article>
        </div>
      </div>
    </main>
  );
}

export function LegalTable({ caption, columns, rows }: { caption: string; columns: string[]; rows: readonly (readonly string[])[] }) {
  return (
    <div className={styles.tableScroll} role="region" aria-label={`${caption} — scroll horizontally on smaller screens`} tabIndex={0}>
      <table>
        <caption>{caption}</caption>
        <thead><tr>{columns.map(column => <th key={column} scope="col">{column}</th>)}</tr></thead>
        <tbody>{rows.map(row => <tr key={row[0]}>{row.map((cell, index) => index === 0
          ? <th key={index} scope="row">{cell}</th> : <td key={index}>{cell}</td>)}</tr>)}</tbody>
      </table>
    </div>
  );
}
