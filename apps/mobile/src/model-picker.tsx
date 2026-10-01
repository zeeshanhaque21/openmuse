import { useCallback, useEffect, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { Button, Card, colors, ErrorNotice, Field, s } from "./ui";
import { useWorkspace } from "./workspace";

type Catalog = { configured: boolean; activeModel: string | null; models: string[] };
export function ModelPicker() {
  const { api } = useWorkspace();
  const [catalog, setCatalog] = useState<Catalog>();
  const [selected, setSelected] = useState("");
  const [query, setQuery] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    setBusy(true);
    setError("");
    try {
      const next = await api.request<Catalog>("/api/models");
      setCatalog(next);
      setSelected(next.activeModel ?? "");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Cannot load models");
    } finally {
      setBusy(false);
    }
  }, [api]);
  useEffect(() => {
    void load();
  }, [load]);
  if (catalog && !catalog.configured) return null;
  const matches =
    catalog?.models.filter((id) => id.toLowerCase().includes(query.toLowerCase())) ?? [];
  async function save() {
    setBusy(true);
    setError("");
    try {
      const result = await api.request<{ activeModel: string }>("/api/models/selection", {
        modelId: selected,
      });
      setCatalog((current) =>
        current ? { ...current, activeModel: result.activeModel } : current,
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save your model");
    } finally {
      setBusy(false);
    }
  }
  return (
    <Card style={{ gap: 12 }}>
      <Text style={s.heading}>Model · OmniRoute</Text>
      <Text style={s.small}>Active: {catalog?.activeModel ?? "No model selected"}</Text>
      <ErrorNotice error={error} />
      <Button small disabled={busy} onPress={() => void load()}>
        {busy ? "Loading…" : "Refresh models"}
      </Button>
      {catalog && (
        <>
          <Field
            label="Find a model"
            placeholder="Search any provider or model name"
            value={query}
            onChangeText={setQuery}
          />
          <View style={{ gap: 6 }}>
            {matches.slice(0, 20).map((modelId) => (
              <Pressable
                key={modelId}
                accessibilityRole="radio"
                accessibilityLabel={modelId}
                accessibilityState={{ checked: selected === modelId, disabled: busy }}
                disabled={busy}
                onPress={() => setSelected(modelId)}
                style={{
                  padding: 12,
                  borderRadius: 12,
                  backgroundColor: selected === modelId ? colors.sky : colors.canvas,
                }}
              >
                <Text style={s.small}>
                  {selected === modelId ? "✓ " : ""}
                  {modelId}
                </Text>
              </Pressable>
            ))}
            {!matches.length && <Text style={s.small}>No models match your search.</Text>}
            {matches.length > 20 && (
              <Text style={s.small}>
                {matches.length} matches. Refine your search to find any model.
              </Text>
            )}
          </View>
          <Text style={s.small}>Selected: {selected || "None"}</Text>
          <Text style={s.small}>
            OpenMuse never switches models automatically. Provider costs and combo fallback rules
            are controlled in OmniRoute.
          </Text>
          <Button
            primary
            disabled={busy || !selected || selected === catalog.activeModel}
            onPress={() => void save()}
          >
            Use selected model
          </Button>
        </>
      )}
    </Card>
  );
}
