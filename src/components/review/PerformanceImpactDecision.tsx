"use client";

import { useId, useState } from "react";

type ImpactStatus = "applied" | "no_transition" | "pending";
type ImpactDirection = "positive" | "negative";
type ImpactIntensity = "low" | "medium" | "high";

type Props = {
  direction?: string | null;
  id: string;
  intensity?: string | null;
  status?: string | null;
};

function initialStatus(value?: string | null): ImpactStatus {
  return value === "applied" || value === "no_transition" ? value : "no_transition";
}

function initialDirection(status: ImpactStatus, value?: string | null): ImpactDirection {
  return status === "applied" && (value === "positive" || value === "negative") ? value : "positive";
}

function initialIntensity(status: ImpactStatus, value?: string | null): ImpactIntensity {
  return status === "applied" && (value === "low" || value === "medium" || value === "high") ? value : "low";
}

export function PerformanceImpactDecision({ direction, id, intensity, status: storedStatus }: Props) {
  const resolvedStatus = initialStatus(storedStatus);
  const [status, setStatus] = useState<ImpactStatus>(resolvedStatus);
  const [directionValue, setDirectionValue] = useState<ImpactDirection>(() => initialDirection(resolvedStatus, direction));
  const [intensityValue, setIntensityValue] = useState<ImpactIntensity>(() => initialIntensity(resolvedStatus, intensity));
  const fieldsId = useId();

  return <fieldset className="performance-impact-decision">
    <legend>HouseOfBros Performance impact</legend>
    <label>
      <span className="sr-only">Impact decision</span>
      <select
        aria-controls={fieldsId}
        aria-expanded={status === "applied"}
        name={`founder_performance_impact_status:${id}`}
        onChange={(event) => setStatus(event.target.value as ImpactStatus)}
        required
        value={status}
      >
        <option value="no_transition">No transition</option>
        <option value="applied">Apply a transition</option>
        <option value="pending">Impact review pending</option>
      </select>
    </label>
    {status === "applied" ? <div className="performance-impact-fields" id={fieldsId}>
      <label>Direction
        <select
          name={`founder_performance_impact_direction:${id}`}
          onChange={(event) => setDirectionValue(event.target.value as ImpactDirection)}
          required
          value={directionValue}
        >
          <option value="positive">Positive</option>
          <option value="negative">Negative</option>
        </select>
      </label>
      <label>Intensity
        <select
          name={`founder_performance_impact:${id}`}
          onChange={(event) => setIntensityValue(event.target.value as ImpactIntensity)}
          required
          value={intensityValue}
        >
          <option value="low">Low</option>
          <option value="medium">Medium</option>
          <option value="high">High</option>
        </select>
      </label>
    </div> : null}
  </fieldset>;
}
