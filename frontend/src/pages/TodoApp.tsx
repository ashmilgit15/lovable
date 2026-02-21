import { useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import { Trash2, CheckCircle2, Circle } from "lucide-react";
import { Link } from "react-router-dom";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

type Todo = {
  id: string;
  text: string;
  completed: boolean;
  createdAt: string;
};

type Filter = "all" | "active" | "completed";

const STORAGE_KEY = "todo_demo_items_v1";

export default function TodoApp() {
  const [todos, setTodos] = useState<Todo[]>(() => {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    try {
      const parsed = JSON.parse(raw) as Todo[];
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  });
  const [text, setText] = useState("");
  const [filter, setFilter] = useState<Filter>("all");

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(todos));
  }, [todos]);

  const filteredTodos = useMemo(() => {
    if (filter === "active") return todos.filter((todo) => !todo.completed);
    if (filter === "completed") return todos.filter((todo) => todo.completed);
    return todos;
  }, [filter, todos]);

  const activeCount = useMemo(
    () => todos.filter((todo) => !todo.completed).length,
    [todos]
  );

  function addTodo(event: FormEvent) {
    event.preventDefault();
    const trimmed = text.trim();
    if (!trimmed) return;

    setTodos((prev) => [
      {
        id: crypto.randomUUID(),
        text: trimmed,
        completed: false,
        createdAt: new Date().toISOString(),
      },
      ...prev,
    ]);
    setText("");
  }

  function toggleTodo(id: string) {
    setTodos((prev) =>
      prev.map((todo) =>
        todo.id === id ? { ...todo, completed: !todo.completed } : todo
      )
    );
  }

  function removeTodo(id: string) {
    setTodos((prev) => prev.filter((todo) => todo.id !== id));
  }

  function clearCompleted() {
    setTodos((prev) => prev.filter((todo) => !todo.completed));
  }

  return (
    <div className="min-h-screen bg-[#0a0a0a] p-6 text-foreground">
      <div className="mx-auto w-full max-w-2xl space-y-5">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-white">Simple Todo List</h1>
            <p className="text-sm text-gray-400">Add tasks, complete tasks, and stay focused.</p>
          </div>
          <Link to="/">
            <Button variant="ghost" className="text-gray-400 hover:text-white">
              Back
            </Button>
          </Link>
        </div>

        <Card className="border-[#1e1e1e] bg-[#111111]">
          <CardHeader>
            <CardTitle className="text-white">Tasks</CardTitle>
            <CardDescription className="text-gray-400">
              {activeCount} active {activeCount === 1 ? "task" : "tasks"}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <form onSubmit={addTodo} className="flex gap-2">
              <Input
                value={text}
                onChange={(event) => setText(event.target.value)}
                placeholder="What do you need to do?"
                className="border-[#222] bg-[#161616] text-gray-200 focus:border-violet-500/50"
              />
              <Button type="submit" className="bg-violet-600 text-white hover:bg-violet-700">
                Add
              </Button>
            </form>

            <div className="flex flex-wrap items-center gap-2">
              {(["all", "active", "completed"] as Filter[]).map((option) => (
                <Button
                  key={option}
                  size="sm"
                  variant={filter === option ? "default" : "outline"}
                  onClick={() => setFilter(option)}
                  className={
                    filter === option
                      ? "bg-violet-600 text-white hover:bg-violet-700"
                      : "border-[#222] bg-[#161616] text-gray-300 hover:bg-[#1e1e1e]"
                  }
                >
                  {option[0].toUpperCase() + option.slice(1)}
                </Button>
              ))}

              <Button
                size="sm"
                variant="outline"
                onClick={clearCompleted}
                className="ml-auto border-red-500/40 bg-red-500/10 text-red-300 hover:bg-red-500/20"
                disabled={!todos.some((todo) => todo.completed)}
              >
                Clear Completed
              </Button>
            </div>

            <div className="space-y-2">
              {filteredTodos.length === 0 ? (
                <div className="rounded-md border border-dashed border-[#262626] p-5 text-center text-sm text-gray-500">
                  No tasks for this filter.
                </div>
              ) : (
                filteredTodos.map((todo) => (
                  <div
                    key={todo.id}
                    className="flex items-center gap-3 rounded-md border border-[#222] bg-[#161616] px-3 py-2"
                  >
                    <button
                      type="button"
                      onClick={() => toggleTodo(todo.id)}
                      className="text-violet-300 hover:text-violet-200"
                      aria-label={todo.completed ? "Mark as incomplete" : "Mark as complete"}
                    >
                      {todo.completed ? (
                        <CheckCircle2 className="h-5 w-5" />
                      ) : (
                        <Circle className="h-5 w-5" />
                      )}
                    </button>

                    <span
                      className={`flex-1 text-sm ${
                        todo.completed ? "text-gray-500 line-through" : "text-gray-200"
                      }`}
                    >
                      {todo.text}
                    </span>

                    <Button
                      size="icon"
                      variant="ghost"
                      onClick={() => removeTodo(todo.id)}
                      className="h-8 w-8 text-gray-500 hover:bg-red-500/10 hover:text-red-400"
                      aria-label="Delete task"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                ))
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
