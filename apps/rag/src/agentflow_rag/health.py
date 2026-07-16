"""服务 readiness 状态与依赖探针。"""

from __future__ import annotations

from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field

Probe = Callable[[], Awaitable[bool]]


@dataclass(slots=True)
class ReadinessState:
    database_ready: bool = False
    models_ready: bool = False
    index_ready: bool = False
    details: dict[str, str] = field(default_factory=dict)

    @property
    def ready(self) -> bool:
        return self.database_ready and self.models_ready and self.index_ready


class ReadinessService:
    """允许生产探针与测试替身共享相同 readiness 契约。"""

    def __init__(self, database_probe: Probe | None = None) -> None:
        self._database_probe = database_probe
        self.state = ReadinessState()

    async def refresh_database(self) -> bool:
        if self._database_probe is None:
            return self.state.database_ready
        try:
            self.state.database_ready = await self._database_probe()
            self.state.details.pop("database", None)
        except Exception as error:  # readiness 必须返回状态，不能把依赖异常扩散为 500。
            self.state.database_ready = False
            self.state.details["database"] = type(error).__name__
        return self.state.database_ready

    def set_models_ready(self, ready: bool, detail: str | None = None) -> None:
        self.state.models_ready = ready
        if detail:
            self.state.details["models"] = detail
        else:
            self.state.details.pop("models", None)

    def set_index_ready(self, ready: bool, detail: str | None = None) -> None:
        self.state.index_ready = ready
        if detail:
            self.state.details["index"] = detail
        else:
            self.state.details.pop("index", None)
