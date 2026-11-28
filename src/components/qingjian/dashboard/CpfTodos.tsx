import { C2_TODOS } from "./c2Data";

export function CpfTodos({ sampleMode = false }: { sampleMode?: boolean }) {
  return (
    <>
      <div className={"k-sec"}>
        <h2>
          相关待办
          {sampleMode ? (
            <span className={"chip chipSample"}>示例数据</span>
          ) : null}
        </h2>
        <span className={"r"}>已过期的用红底和「！」标出</span>
      </div>
      <div className={"card"}>
        <ul className={"ck"}>
          {C2_TODOS.map((item) => {
            const liClass = [
              item.overdue ? "k-late" : "",
              item.irreversible ? "k-risk" : "",
            ]
              .filter(Boolean)
              .join(" ");
            return (
              <li key={item.title} className={liClass || undefined}>
                <span className={"box"} role="img" aria-label="未完成" />
                <div>
                  <span className={"t"}>
                    {item.irreversible ? (
                      <>
                        OA 转 SA（<em>不可逆</em>，需玄空哥决定）
                      </>
                    ) : (
                      item.title
                    )}
                  </span>
                  <span className={"sub"}>{item.sub}</span>
                </div>
                <div className={"r"}>
                  {item.irreversible ? (
                    <span className={"k-badgeRed"}>！ 不可逆</span>
                  ) : null}
                  {item.overdue ? (
                    <span className={"chip k-chipRed"}>！ {item.due}</span>
                  ) : item.info ? (
                    <span className={"chip k-chipInfo"}>{item.due}</span>
                  ) : (
                    <span className={"chip chipNeutral"}>{item.due}</span>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      </div>
    </>
  );
}
