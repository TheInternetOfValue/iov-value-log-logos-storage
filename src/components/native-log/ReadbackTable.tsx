import type { NativeDraft } from "@/lib/native-log/draft";
function time(value: string) {
  return value ? value.slice(11, 16) : "Not stated";
}
export function ReadbackTable({ document }: { document: NativeDraft }) {
  return (
    <div className="native-readback-wrap">
      <table className="native-readback">
        <caption className="sr-only">
          Your proposed Value Log. Speak again to correct or add something.
        </caption>
        <thead>
          <tr>
            <th scope="col">Time</th>
            <th scope="col">What happened</th>
            <th scope="col">Reading</th>
          </tr>
        </thead>
        <tbody>
          {document.activities.map((a) => (
            <tr key={a.id}>
              <td>
                <span className="native-readback-time" title={a.timeNote}>
                  {a.timeNote ? "≈ " : ""}
                  {time(a.startLocal)}
                  <br />
                  <span aria-hidden="true">– </span>
                  {time(a.endLocal)}
                </span>
                {a.startLocal &&
                a.endLocal &&
                a.startLocal.slice(0, 10) !== a.endLocal.slice(0, 10) ? (
                  <small>Ends {a.endLocal.slice(0, 10)}</small>
                ) : null}
                {a.timeNote ? (
                  <small>
                    {a.timeNote.startsWith("Approximate start:")
                      ? a.timeNote.split(".")[0]
                      : "Proposed start"}
                  </small>
                ) : null}
              </td>
              <td>
                <strong>{a.activity}</strong>
                {a.context ? <small>{a.context}</small> : null}
              </td>
              <td>
                <span>{a.node || "To establish"}</span>
                {a.community ? (
                  <small>
                    {document.cohort?.workCommunities.find(
                      (c) => c.id === a.community,
                    )?.name ??
                      (
                        {
                          house_of_bros: "HouseOfBros",
                          house_of_sis: "HouseOfSis",
                          iov: "IoV Research Foundation",
                          gfe: "Growth Flow Engineering",
                        } as Record<string, string>
                      )[a.community] ??
                      a.community}
                    {a.lane ? ` · ${a.lane}` : ""}
                  </small>
                ) : null}
                <small>
                  Reported effect:{" "}
                  {a.direction
                    ? `${a.direction}${a.intensity ? ` · ${a.intensity}` : ""}`
                    : "Not reported"}
                </small>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
