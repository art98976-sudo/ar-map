import ClientApp from "@/components/app/ClientApp";

export default function Home() {
  return (
    <>
      <ClientApp />
      <noscript>
        <p style={{ padding: 16 }}>The Stirling Campus Map needs JavaScript to show the map and directions.</p>
      </noscript>
    </>
  );
}
