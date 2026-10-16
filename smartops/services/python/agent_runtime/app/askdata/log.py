"""Stand-in for twise_common.utils.logger: plain stdlib loggers under "askdata"."""
import logging


def get_agent_logger(name: str) -> logging.Logger:
    return logging.getLogger(f"askdata.{name}")


def get_logger(name: str) -> logging.Logger:
    return logging.getLogger(f"askdata.{name}")
