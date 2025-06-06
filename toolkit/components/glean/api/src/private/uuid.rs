// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

use inherent::inherent;

use uuid::Uuid;

use super::{BaseMetricId, CommonMetricData};

use crate::ipc::need_ipc;

/// A UUID metric.
///
/// Stores UUID values.
pub enum UuidMetric {
    Parent {
        /// The metric's ID. Used for testing and profiler markers. UUID
        /// metrics canot be labeled, so we only store a BaseMetricId. If this
        /// changes, this should be changed to a MetricId to distinguish
        /// between metrics and sub-metrics.
        id: BaseMetricId,
        inner: glean::private::UuidMetric,
    },
    Child(UuidMetricIpc),
}

#[derive(Debug, Clone)]
pub struct UuidMetricIpc;

crate::define_metric_metadata_getter!(UuidMetric, UUID_MAP);
crate::define_metric_namer!(UuidMetric, PARENT_ONLY);

impl UuidMetric {
    /// Create a new UUID metric.
    pub fn new(id: BaseMetricId, meta: CommonMetricData) -> Self {
        if need_ipc() {
            UuidMetric::Child(UuidMetricIpc)
        } else {
            UuidMetric::Parent {
                id,
                inner: glean::private::UuidMetric::new(meta),
            }
        }
    }

    #[cfg(test)]
    pub(crate) fn child_metric(&self) -> Self {
        match self {
            UuidMetric::Parent { .. } => UuidMetric::Child(UuidMetricIpc),
            UuidMetric::Child(_) => panic!("Can't get a child metric from a child metric"),
        }
    }
}

#[inherent]
impl glean::traits::Uuid for UuidMetric {
    /// Set to the specified value.
    ///
    /// ## Arguments
    ///
    /// * `value` - The UUID to set the metric to.
    pub fn set(&self, value: Uuid) {
        match self {
            #[allow(unused)]
            UuidMetric::Parent { id, inner } => {
                let value = value.to_string();
                #[cfg(feature = "with_gecko")]
                gecko_profiler::lazy_add_marker!(
                    "Uuid::set",
                    super::profiler_utils::TelemetryProfilerCategory,
                    super::profiler_utils::StringLikeMetricMarker::<UuidMetric>::new(
                        (*id).into(),
                        &value
                    )
                );
                inner.set(value)
            }
            UuidMetric::Child(_c) => {
                log::error!("Unable to set the uuid metric in non-main process. This operation will be ignored.");
                // If we're in automation we can panic so the instrumentor knows they've gone wrong.
                // This is a deliberate violation of Glean's "metric APIs must not throw" design.
                assert!(!crate::ipc::is_in_automation(), "Attempted to set uuid metric in non-main process, which is forbidden. This panics in automation.");
                // TODO: Record an error.
            }
        };
    }

    /// Generate a new random UUID and set the metric to it.
    ///
    /// ## Return value
    ///
    /// Returns the stored UUID value or `Uuid::nil` if called from
    /// a non-main process.
    pub fn generate_and_set(&self) -> Uuid {
        match self {
            #[allow(unused)]
            UuidMetric::Parent { id, inner } => {
                let uuid = inner.generate_and_set();
                #[cfg(feature = "with_gecko")]
                gecko_profiler::lazy_add_marker!(
                    "Uuid::generateAndSet",
                    super::profiler_utils::TelemetryProfilerCategory,
                    super::profiler_utils::StringLikeMetricMarker::<UuidMetric>::new(
                        (*id).into(),
                        &uuid
                    )
                );
                Uuid::parse_str(&uuid).unwrap()
            }
            UuidMetric::Child(_c) => {
                log::error!("Unable to set the uuid metric in non-main process. This operation will be ignored.");
                // If we're in automation we can panic so the instrumentor knows they've gone wrong.
                // This is a deliberate violation of Glean's "metric APIs must not throw" design.
                assert!(!crate::ipc::is_in_automation(), "Attempted to set uuid metric in non-main process, which is forbidden. This panics in automation.");
                // TODO: Record an error.
                Uuid::nil()
            }
        }
    }

    /// **Test-only API.**
    ///
    /// Get the stored UUID value.
    /// This doesn't clear the stored value.
    ///
    /// ## Arguments
    ///
    /// * `storage_name` - the storage name to look into.
    ///
    /// ## Return value
    ///
    /// Returns the stored value or `None` if nothing stored.
    pub fn test_get_value<'a, S: Into<Option<&'a str>>>(&self, storage_name: S) -> Option<Uuid> {
        let storage_name = storage_name.into().map(|s| s.to_string());
        match self {
            UuidMetric::Parent { inner, .. } => inner
                .test_get_value(storage_name)
                .and_then(|s| Uuid::parse_str(&s).ok()),
            UuidMetric::Child(_c) => panic!("Cannot get test value for in non-main process!"),
        }
    }

    /// **Exported for test purposes.**
    ///
    /// Gets the number of recorded errors for the given metric and error type.
    ///
    /// # Arguments
    ///
    /// * `error` - The type of error
    /// * `ping_name` - represents the optional name of the ping to retrieve the
    ///   metric for. Defaults to the first value in `send_in_pings`.
    ///
    /// # Returns
    ///
    /// The number of errors reported.
    pub fn test_get_num_recorded_errors(&self, error: glean::ErrorType) -> i32 {
        match self {
            UuidMetric::Parent { inner, .. } => inner.test_get_num_recorded_errors(error),
            UuidMetric::Child(_c) => {
                panic!("Cannot get test value for UuidMetric in non-main process!")
            }
        }
    }
}

#[cfg(test)]
mod test {
    use super::*;
    use crate::{common_test::*, ipc, metrics};

    #[test]
    fn sets_uuid_value() {
        let _lock = lock_test();

        let metric = &metrics::test_only_ipc::a_uuid;
        let expected = Uuid::new_v4();
        metric.set(expected.clone());

        assert_eq!(expected, metric.test_get_value("test-ping").unwrap());
    }

    #[test]
    fn uuid_ipc() {
        // UuidMetric doesn't support IPC.
        let _lock = lock_test();

        let parent_metric = &metrics::test_only_ipc::a_uuid;
        let expected = Uuid::new_v4();
        parent_metric.set(expected.clone());

        {
            let child_metric = parent_metric.child_metric();

            // Instrumentation calls do not panic.
            child_metric.set(Uuid::new_v4());

            // (They also shouldn't do anything,
            // but that's not something we can inspect in this test)
        }

        assert!(ipc::replay_from_buf(&ipc::take_buf().unwrap()).is_ok());

        assert_eq!(
            expected,
            parent_metric.test_get_value("test-ping").unwrap(),
            "UUID metrics should only work in the parent process"
        );
    }
}
