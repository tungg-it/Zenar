import { Empty } from "antd";
import { LuCircleCheck, LuCircleX } from "react-icons/lu";
import type { TestResult } from "@/libs/scripts";

/** `zn.test` results of the post-response script, failed ones with their assertion message. */
export function TestResults({ tests }: { tests: TestResult[] }) {
  if (tests.length === 0) return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={'No tests. Add zn.test("name", () => ...) in the After response script.'} />;
  const passed = tests.filter((t) => t.passed).length;
  return (
    <div className="flex flex-col">
      <p className="mt-0 mb-1.5 text-sm text-z-muted">
        {passed} / {tests.length} passed
      </p>
      {tests.map((t, i) => (
        <div key={i} className="flex items-start gap-2 border-t border-z-border py-1.5">
          {t.passed ? <LuCircleCheck className="mt-0.5 flex-none text-z-get" aria-label="Passed" /> : <LuCircleX className="mt-0.5 flex-none text-z-delete" aria-label="Failed" />}
          <div className="min-w-0 select-text">
            <div className="text-z-text">{t.name}</div>
            {t.error && <div className="font-mono text-code break-words text-z-delete">{t.error}</div>}
          </div>
        </div>
      ))}
    </div>
  );
}
